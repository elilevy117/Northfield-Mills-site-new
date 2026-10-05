import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const ORIGIN = "https://northfieldmills.com";
const RESOURCE = `${ORIGIN}/mcp`;
const SCOPES = ["leads:read", "leads:write"];
const json = (body, status=200, headers={}) => new Response(JSON.stringify(body), {status, headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}});
const html = (body, status=200) => new Response(body,{status,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
const authStore = () => getStore("northfield-mcp-auth",{consistency:"strong"});
const leadsStore = () => getStore("northfield-portal-data",{consistency:"strong"});
const random = (n=32) => crypto.randomBytes(n).toString("base64url");
const challenge = s => crypto.createHash("sha256").update(s).digest("base64url");

function oauthMeta(){return {
  issuer:ORIGIN, authorization_endpoint:`${ORIGIN}/oauth/authorize`,
  token_endpoint:`${ORIGIN}/oauth/token`, registration_endpoint:`${ORIGIN}/oauth/register`,
  response_types_supported:["code"], grant_types_supported:["authorization_code","refresh_token"],
  code_challenge_methods_supported:["S256"], token_endpoint_auth_methods_supported:["none"],
  scopes_supported:SCOPES
};}

async function register(req){
  const b=await req.json().catch(()=>({}));
  const redirects=Array.isArray(b.redirect_uris)?b.redirect_uris.filter(x=>/^https:\/\//i.test(x)):[];
  if(!redirects.length)return json({error:"invalid_redirect_uri"},400);
  const client_id=random(24), rec={client_id,client_name:b.client_name||"ChatGPT",redirect_uris:redirects,token_endpoint_auth_method:"none",grant_types:["authorization_code","refresh_token"],response_types:["code"]};
  await authStore().setJSON(`client/${client_id}`,rec);
  return json(rec,201);
}

async function authorize(req){
  let vals={};
  if(req.method==="GET") vals=Object.fromEntries(new URL(req.url).searchParams);
  else {
    const f=await req.formData(); vals=Object.fromEntries(f.entries());
    const expected=Netlify.env.get("NORTHFIELD_MCP_ACCESS_CODE")||"";
    const supplied=String(vals.access_code||"");
    if(!expected || supplied.length!==expected.length || !crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected))) return html("<h2>Incorrect access code.</h2>",403);
  }
  const client=vals.client_id?await authStore().get(`client/${vals.client_id}`,{type:"json"}):null;
  if(!client || !client.redirect_uris?.includes(vals.redirect_uri) || vals.response_type!=="code" || vals.code_challenge_method!=="S256" || !vals.code_challenge) return html("<h2>Invalid authorization request.</h2>",400);
  if(vals.resource && vals.resource!==RESOURCE)return html("<h2>Invalid resource.</h2>",400);
  if(req.method==="GET"){
    const esc=s=>String(s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
    const hidden=Object.entries(vals).map(([k,v])=>`<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
    return html(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Northfield Mills CRM</title><style>body{font-family:system-ui;background:#f7f4ef;color:#172033;display:grid;place-items:center;min-height:100vh;margin:0}.c{width:min(430px,88vw);background:#fff;padding:30px;border-radius:18px;box-shadow:0 12px 40px #0002}h1{margin:0 0 8px;font-size:25px}p{line-height:1.45;color:#596273}label{display:block;font-weight:650;margin:22px 0 8px}input[type=password]{width:100%;box-sizing:border-box;padding:13px;border:1px solid #ccd1d8;border-radius:10px;font-size:16px}button{width:100%;margin-top:16px;padding:13px;border:0;border-radius:10px;background:#a82114;color:white;font-weight:700;font-size:16px}.small{font-size:12px}</style><div class="c"><h1>Northfield Mills CRM</h1><p>ChatGPT is requesting access to your manufacturer Leads.</p><form method="post" action="/oauth/authorize">${hidden}<label>Northfield access code</label><input name="access_code" type="password" required autofocus><button>Authorize ChatGPT</button></form><p class="small">Only continue if you initiated this connection from ChatGPT.</p></div>`);
  }
  const code=random(), scope=String(vals.scope||"leads:read leads:write").split(/\s+/).filter(x=>SCOPES.includes(x)).join(" ")||"leads:read";
  await authStore().setJSON(`code/${code}`,{client_id:vals.client_id,redirect_uri:vals.redirect_uri,code_challenge:vals.code_challenge,resource:vals.resource||RESOURCE,scope,expires_at:Date.now()+300000});
  const r=new URL(vals.redirect_uri); r.searchParams.set("code",code); if(vals.state)r.searchParams.set("state",vals.state);
  return Response.redirect(r,302);
}

async function token(req){
  const f=await req.formData(), grant=String(f.get("grant_type")||"");
  if(grant==="authorization_code"){
    const c=String(f.get("code")||""), rec=await authStore().get(`code/${c}`,{type:"json"});
    if(!rec||rec.expires_at<Date.now()||String(f.get("client_id")||"")!==rec.client_id||String(f.get("redirect_uri")||"")!==rec.redirect_uri||challenge(String(f.get("code_verifier")||""))!==rec.code_challenge)return json({error:"invalid_grant"},400);
    await authStore().delete(`code/${c}`);
    const access=random(), refresh=random(), base={client_id:rec.client_id,scope:rec.scope,resource:rec.resource};
    await authStore().setJSON(`access/${access}`,{...base,expires_at:Date.now()+3600000});
    await authStore().setJSON(`refresh/${refresh}`,{...base,expires_at:Date.now()+30*86400000});
    return json({access_token:access,token_type:"Bearer",expires_in:3600,refresh_token:refresh,scope:rec.scope});
  }
  if(grant==="refresh_token"){
    const rt=String(f.get("refresh_token")||""), rec=await authStore().get(`refresh/${rt}`,{type:"json"});
    if(!rec||rec.expires_at<Date.now())return json({error:"invalid_grant"},400);
    const access=random(); await authStore().setJSON(`access/${access}`,{...rec,expires_at:Date.now()+3600000});
    return json({access_token:access,token_type:"Bearer",expires_in:3600,refresh_token:rt,scope:rec.scope});
  }
  return json({error:"unsupported_grant_type"},400);
}

async function bearer(req){
  const m=(req.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i); if(!m)return null;
  const rec=await authStore().get(`access/${m[1]}`,{type:"json"});
  return rec&&rec.expires_at>Date.now()&&rec.resource===RESOURCE?rec:null;
}

const tools=[
{name:"list_leads",description:"List Northfield Mills manufacturer leads. Optionally filter by status.",inputSchema:{type:"object",properties:{status:{type:"string"}},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:"search_leads",description:"Search manufacturer leads by company, contact, email, website, notes, Lead ID, or next step.",inputSchema:{type:"object",properties:{query:{type:"string"}},required:["query"],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:"get_lead",description:"Get one manufacturer lead by Lead ID.",inputSchema:{type:"object",properties:{id:{type:"string"}},required:["id"],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
{name:"add_lead",description:"Add a manufacturer lead to the Northfield Mills CRM.",inputSchema:{type:"object",properties:{company:{type:"string"},contact:{type:"string"},title:{type:"string"},email:{type:"string"},phone:{type:"string"},website:{type:"string"},linkedin:{type:"string"},status:{type:"string"},stage:{type:"string"},last:{type:"string"},reminder:{type:"string"},next:{type:"string"},notes:{type:"string"}},required:["company"],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
{name:"update_lead",description:"Update fields on an existing manufacturer lead.",inputSchema:{type:"object",properties:{id:{type:"string"},patch:{type:"object",additionalProperties:true}},required:["id","patch"],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
{name:"delete_lead",description:"Delete a manufacturer lead from the CRM.",inputSchema:{type:"object",properties:{id:{type:"string"}},required:["id"],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:false}}
];

const tr=o=>({content:[{type:"text",text:JSON.stringify(o,null,2)}],structuredContent:o});
async function callTool(name,a,tok){
  const s=leadsStore(), leads=(await s.get("manufacturer-leads",{type:"json"}))||[];
  if(name==="list_leads"){const rows=a?.status?leads.filter(x=>x.status===a.status):leads;return tr({count:rows.length,leads:rows});}
  if(name==="search_leads"){const q=String(a?.query||"").toLowerCase();const rows=leads.filter(x=>[x.id,x.company,x.contact,x.title,x.email,x.phone,x.website,x.linkedin,x.status,x.stage,x.next,x.notes].join(" ").toLowerCase().includes(q));return tr({count:rows.length,leads:rows});}
  if(name==="get_lead"){const lead=leads.find(x=>String(x.id)===String(a?.id));return lead?tr({lead}):{isError:true,content:[{type:"text",text:"Lead not found."}]};}
  if(!String(tok.scope||"").split(/\s+/).includes("leads:write"))return {isError:true,content:[{type:"text",text:"Write permission is not enabled for this connection."}]};
  if(name==="add_lead"){
    const id="L"+Date.now(), x={id,company:a.company||"",contact:a.contact||"",title:a.title||"",email:a.email||"",phone:a.phone||"",website:a.website||"",linkedin:a.linkedin||"",primary:true,status:a.status||"sent",last:a.last||"",stage:a.stage||"initial",reminder:a.reminder||"",next:a.next||"",notes:a.notes||"",history:[]};
    leads.unshift(x); await s.setJSON("manufacturer-leads",leads); return tr({ok:true,lead:x});
  }
  if(name==="update_lead"){
    const i=leads.findIndex(x=>String(x.id)===String(a?.id)); if(i<0)return {isError:true,content:[{type:"text",text:"Lead not found."}]};
    const blocked=new Set(["id","companyId"]); const patch={...(a.patch||{})}; for(const k of blocked)delete patch[k];
    leads[i]={...leads[i],...patch}; await s.setJSON("manufacturer-leads",leads); return tr({ok:true,lead:leads[i]});
  }
  if(name==="delete_lead"){
    const i=leads.findIndex(x=>String(x.id)===String(a?.id)); if(i<0)return {isError:true,content:[{type:"text",text:"Lead not found."}]};
    const [removed]=leads.splice(i,1); await s.setJSON("manufacturer-leads",leads); return tr({ok:true,deleted:removed});
  }
  return {isError:true,content:[{type:"text",text:"Unknown tool."}]};
}

async function mcp(req){
  if(req.method==="GET")return new Response(null,{status:405,headers:{"allow":"POST"}});
  if(req.method!=="POST")return new Response(null,{status:405});
  const tok=await bearer(req);
  if(!tok)return json({error:"unauthorized"},401,{"www-authenticate":`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource", scope="leads:read leads:write"`});
  const b=await req.json().catch(()=>null); if(!b||b.jsonrpc!=="2.0")return json({jsonrpc:"2.0",id:null,error:{code:-32600,message:"Invalid Request"}});
  if(b.method==="initialize")return json({jsonrpc:"2.0",id:b.id,result:{protocolVersion:b.params?.protocolVersion||"2025-06-18",capabilities:{tools:{}},serverInfo:{name:"Northfield Mills CRM",version:"1.0.0"},instructions:"Use these tools only for Northfield Mills manufacturer CRM work. Read tools inspect the private Leads store. Write tools change the same CRM data used by the Northfield Mills Team Portal."}});
  if(b.method==="notifications/initialized")return new Response(null,{status:202});
  if(b.method==="ping")return json({jsonrpc:"2.0",id:b.id,result:{}});
  if(b.method==="tools/list")return json({jsonrpc:"2.0",id:b.id,result:{tools}});
  if(b.method==="tools/call"){
    const result=await callTool(b.params?.name,b.params?.arguments||{},tok);
    return json({jsonrpc:"2.0",id:b.id,result});
  }
  return json({jsonrpc:"2.0",id:b.id??null,error:{code:-32601,message:"Method not found"}});
}

export default async req=>{
  const p=new URL(req.url).pathname;
  if(p==="/.well-known/oauth-protected-resource")return json({resource:RESOURCE,authorization_servers:[ORIGIN],scopes_supported:SCOPES,resource_documentation:"https://northfieldmills.com/"});
  if(p==="/.well-known/oauth-authorization-server"||p==="/.well-known/openid-configuration")return json(oauthMeta());
  if(p==="/oauth/register"&&req.method==="POST")return register(req);
  if(p==="/oauth/authorize"&&(req.method==="GET"||req.method==="POST"))return authorize(req);
  if(p==="/oauth/token"&&req.method==="POST")return token(req);
  if(p==="/mcp")return mcp(req);
  return new Response("Not found",{status:404});
};

export const config={path:["/mcp","/.well-known/oauth-protected-resource","/.well-known/oauth-authorization-server","/.well-known/openid-configuration","/oauth/register","/oauth/authorize","/oauth/token"]};
