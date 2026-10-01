// netlify/functions/gmail.mjs
// Company Gmail for the Northfield Mills team portal: read mail, list Send-as addresses, send email.
// Sending needs the gmail.send permission: after deploying, click "Reconnect Gmail" in the portal once.
import {getStore} from '@netlify/blobs';import {json,me} from '../lib/server.mjs';const S=()=>getStore('northfield-gmail');async function token(){const s=S(),v=await s.get('oauth',{type:'json'});if(!v?.refresh_token)return null;if(v.access_token&&v.expires_at>Date.now()+60000)return v.access_token;const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID||'',client_secret:process.env.GOOGLE_CLIENT_SECRET||'',refresh_token:v.refresh_token,grant_type:'refresh_token'})}),j=await r.json();if(!r.ok)throw Object.assign(new Error('Reconnect Gmail.'),{code:'reconnect'});v.access_token=j.access_token;v.expires_at=Date.now()+j.expires_in*1000;await s.setJSON('oauth',v);return v.access_token}async function G(p,t){const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+p,{headers:{authorization:'Bearer '+t}}),j=await r.json();if(!r.ok)throw new Error(j.error?.message||'Gmail error');return j}
// ---- sending: helpers ----
async function GP(p,t,body){
  const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+p,{method:'POST',headers:{authorization:'Bearer '+t,'content-type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){
    const e=new Error(j.error?.message||'Gmail didn’t send it.');
    if(r.status===403&&/insufficient|scope|permission/i.test(e.message)){e.code='scope';e.message='Gmail hasn’t been given permission to send yet. Click “Reconnect Gmail” in the portal and approve “Send email on your behalf”.'}
    throw e;
  }
  return j;
}
// email headers must be plain ASCII: encode names/subjects with accents, emoji, curly quotes, etc.
const ENC=x=>/^[\x20-\x7e]*$/.test(x)?x:'=?UTF-8?B?'+Buffer.from(x,'utf8').toString('base64')+'?=';
// Gmail signature HTML -> plain text (for the plain-text copy of the email)
const SIGTEXT=h=>String(h||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(div|p|tr|li|h\d)>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
const HTMLESC=x=>x.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const B64=x=>Buffer.from(x,'utf8').toString('base64').replace(/.{76}/g,'$&\r\n');
const OKMAIL=x=>/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]{2,}$/.test(x);
const H=(m,n)=>(m.payload?.headers||[]).find(h=>h.name.toLowerCase()===n)?.value||'',A=x=>{const m=String(x).match(/^(.*?)\s*<([^>]+)>$/);return m?{name:m[1].replace(/["']/g,'').trim(),email:m[2]}:{name:'',email:String(x)}},D=x=>Buffer.from(x||'','base64url').toString('utf8');function B(p){if(p?.body?.data)return D(p.body.data);for(const x of p?.parts||[]){if(x.mimeType==='text/plain'&&x.body?.data)return D(x.body.data);const z=B(x);if(z)return z}return''}export default async req=>{try{if(!await me(req))return json(401,{error:'Sign in first.',code:'signin'});const u=new URL(req.url),a=u.searchParams.get('action')||'status',s=S();if(a==='status'){const v=await s.get('oauth',{type:'json'});return json(200,{connected:!!v?.refresh_token,email:v?.email||'',configured:!!(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET),redirectUri:new URL('/.netlify/functions/gmail-callback',req.url).href})}if(a==='auth-url'){if(!process.env.GOOGLE_CLIENT_ID||!process.env.GOOGLE_CLIENT_SECRET)return json(400,{error:'Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Netlify.',code:'setup'});const state=crypto.randomUUID();await s.setJSON('state/'+state,{at:Date.now()});const q=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:new URL('/.netlify/functions/gmail-callback',req.url).href,response_type:'code',scope:'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send openid email',access_type:'offline',prompt:'consent',state});return json(200,{url:'https://accounts.google.com/o/oauth2/v2/auth?'+q})}if(a==='disconnect'){await s.delete('oauth');return json(200,{ok:true})}const t=await token();if(!t)return json(401,{error:'Gmail needs to be connected.',code:'reconnect'});
// ---- Send-as addresses (aliases) on this Gmail ----
if(a==='sendas'){
  const j=await G('settings/sendAs',t);
  return json(200,{sendAs:(j.sendAs||[]).map(x=>({email:x.sendAsEmail,name:x.displayName||'',isDefault:!!x.isDefault,isPrimary:!!x.isPrimary,signature:x.signature||'',verificationStatus:x.verificationStatus||'accepted'}))});
}
// ---- Send an email (optionally as a reply in an existing thread) ----
if(a==='send'){
  if(req.method!=='POST')return json(405,{error:'Use POST.'});
  const d=await req.json().catch(()=>({}));
  const to=String(d.to||'').trim();
  const subject=String(d.subject||'').replace(/[\r\n]+/g,' ').trim().slice(0,250);
  const text=String(d.body||'');
  if(!OKMAIL(to))return json(400,{error:'Add a valid To address.',code:'input'});
  if(!text.trim())return json(400,{error:'The message is empty.',code:'input'});
  // only send from an address Gmail has verified for this mailbox
  const sa=((await G('settings/sendAs',t)).sendAs||[]).filter(x=>!x.verificationStatus||x.verificationStatus==='accepted');
  const want=String(d.from||'').trim().toLowerCase();
  const pick=sa.find(x=>x.sendAsEmail.toLowerCase()===want)||sa.find(x=>x.isDefault)||sa[0];
  if(want&&(!pick||pick.sendAsEmail.toLowerCase()!==want))return json(400,{error:want+' isn’t a verified “Send mail as” address on this Gmail.',code:'input'});
  const head=['To: '+to];
  if(pick)head.push('From: '+(pick.displayName?ENC(pick.displayName)+' <'+pick.sendAsEmail+'>':pick.sendAsEmail));
  head.push('Subject: '+ENC(subject),'MIME-Version: 1.0');
  // replying in a thread: point at their latest message so it groups correctly for both sides
  let threadId=String(d.threadId||'').trim()||undefined;
  if(threadId){
    try{
      const th=await G('threads/'+encodeURIComponent(threadId)+'?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References',t);
      const last=th.messages?.at(-1),mid=last?H(last,'message-id'):'';
      if(mid)head.push('In-Reply-To: '+mid,'References: '+(H(last,'references')+' '+mid).trim());
    }catch{threadId=undefined}
  }
  // Gmail doesn't add signatures to API-sent mail: add this address's Gmail signature when asked
  const sig=d.signature===true&&pick?.signature?String(pick.signature):'';
  const crlf=x=>x.replace(/\r?\n/g,'\r\n');
  let mime;
  if(sig){
    const bnd='nm_'+crypto.randomUUID().replace(/-/g,'');
    const plain=crlf(text.replace(/\s+$/,'')+'\n\n-- \n'+SIGTEXT(sig));
    const html='<div dir="ltr">'+HTMLESC(text.replace(/\s+$/,'')).replace(/\r?\n/g,'<br>')+'<br><br><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">'+sig+'</div></div>';
    head.push('Content-Type: multipart/alternative; boundary="'+bnd+'"');
    mime=head.join('\r\n')+'\r\n\r\n'
      +'--'+bnd+'\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+B64(plain)+'\r\n'
      +'--'+bnd+'\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+B64(html)+'\r\n'
      +'--'+bnd+'--';
  }else{
    head.push('Content-Type: text/plain; charset="UTF-8"','Content-Transfer-Encoding: base64');
    mime=head.join('\r\n')+'\r\n\r\n'+B64(crlf(text));
  }
  const raw=Buffer.from(mime,'utf8').toString('base64url');
  const sent=await GP('messages/send',t,threadId?{raw,threadId}:{raw});
  return json(200,{sent:true,id:sent.id,threadId:sent.threadId,from:pick?.sendAsEmail||'',signature:!!sig});
}
if(a==='unread'){const j=await G('messages?q='+encodeURIComponent('in:inbox is:unread')+'&maxResults=1',t);return json(200,{unread:j.resultSizeEstimate||0})}if(a==='threads'){const q=u.searchParams.get('q')||'in:inbox',j=await G('threads?maxResults=15&q='+encodeURIComponent(q)+(u.searchParams.get('pageToken')?'&pageToken='+encodeURIComponent(u.searchParams.get('pageToken')):''),t);const threads=[];for(const x of (j.threads||[])){const d=await G('threads/'+x.id+'?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To',t),m=d.messages?.at(-1)||{},f=A(H(m,'from')),to=A(H(m,'to'));threads.push({id:x.id,subject:H(m,'subject'),snippet:m.snippet||'',fromName:f.name,fromEmail:f.email,toName:to.name,toEmail:to.email,dateLabel:new Date(+m.internalDate).toLocaleString(),unread:(m.labelIds||[]).includes('UNREAD')});await new Promise(r=>setTimeout(r,75));}return json(200,{threads,nextPageToken:j.nextPageToken||''})}if(a==='thread'){const d=await G('threads/'+u.searchParams.get('id')+'?format=full',t),ms=(d.messages||[]).map(m=>{const f=A(H(m,'from')),to=A(H(m,'to'));return{id:m.id,fromName:f.name,fromEmail:f.email,toName:to.name,toEmail:to.email,dateLabel:new Date(+m.internalDate).toLocaleString(),body:B(m.payload),snippet:m.snippet||'',attachments:[]}}),m=d.messages?.at(-1)||{},f=A(H(m,'from'));return json(200,{thread:{id:d.id,subject:H(m,'subject'),contact:f,messages:ms}})}return json(400,{error:'Unknown action.'})}catch(e){return json(e.code==='reconnect'?401:e.code==='scope'?403:500,{error:e.message,code:e.code||'gmail'})}};
