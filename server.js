// Imtihon sayti serveri. Faqat Node.js (>=18) kerak, qo'shimcha paket o'rnatilmaydi.
// Ishga tushirish:  node server.js   (ADMIN_PASS=... PORT=3000 sozlash mumkin)
const http=require("http"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const PORT=process.env.PORT||3000,FILE=path.join(__dirname,"data.json"),PUB=path.join(__dirname,"public");
const uid=()=>crypto.randomBytes(5).toString("hex");
const hash=(p,salt=crypto.randomBytes(8).toString("hex"))=>salt+":"+crypto.scryptSync(p,salt,32).toString("hex");
const check=(p,h)=>{const x=hash(p,h.split(":")[0]);return x.length===h.length&&crypto.timingSafeEqual(Buffer.from(x),Buffer.from(h))};
function seed(){
  const S={"Ona tili":["Imlo","Grammatika"],"Adabiyot":["Nazm","Nasr"],"Matematika":["Arifmetika","Masalalar"],"Algebra":["Tenglamalar","Funksiyalar"],"Geometriya":["Uchburchaklar","Aylana"],"Fizika":["Mexanika","Elektr"],"Kimyo":["Noorganik","Organik"],"Biologiya":["Botanika","Zoologiya"],"Tarix":["Jahon tarixi","O'zbekiston tarixi"],"Geografiya":["Fizik geografiya","Iqtisodiy geografiya"],"Informatika":["Algoritmlar","Dasturlash"],"Ingliz tili":["Grammar","Vocabulary"]};
  return {subjects:Object.entries(S).map(([n,c])=>({id:uid(),name:n,cats:c.map(x=>({id:uid(),name:x}))})),
    users:[{id:"admin",name:"Super admin",login:"admin",pass:hash(process.env.ADMIN_PASS||"admin123"),role:"admin"}],questions:[],results:[],sessions:{}};
}
let db;try{db=JSON.parse(fs.readFileSync(FILE,"utf8"))}catch(e){db=seed()}
const save=()=>{fs.writeFileSync(FILE+".tmp",JSON.stringify(db));fs.renameSync(FILE+".tmp",FILE)};save();
const pub=u=>({id:u.id,name:u.name,login:u.login,role:u.role,teacherId:u.teacherId});
const str=(v,n=500)=>typeof v==="string"&&v.trim()&&v.length<=n?v.trim():null;
const bad=m=>{throw {code:400,msg:m}};
function state(u){
  const o={subjects:db.subjects};
  if(u.role==="admin"){o.users=db.users.map(pub);o.questions=[];o.results=db.results}
  else if(u.role==="teacher"){const st=db.users.filter(x=>x.teacherId===u.id);o.users=[pub(u),...st.map(pub)];
    o.questions=db.questions.filter(q=>q.teacherId===u.id);o.results=db.results.filter(r=>st.some(s=>s.id===r.studentId))}
  else{const t=db.users.find(x=>x.id===u.teacherId);o.users=[pub(u),...(t?[pub(t)]:[])];
    o.questions=db.questions.filter(q=>q.teacherId===u.teacherId).map(({ans,...q})=>q);o.results=db.results.filter(r=>r.studentId===u.id)}
  return {me:pub(u),db:o};
}
const subj=id=>db.subjects.find(s=>s.id===id);
const acts={
  admin:{
    addSubj:d=>{const n=str(d.name,80);if(!n)bad("Fan nomi kerak");db.subjects.push({id:uid(),name:n,cats:[]})},
    delSubj:d=>{db.subjects=db.subjects.filter(s=>s.id!==d.id);db.questions=db.questions.filter(q=>q.subjectId!==d.id)},
    addCat:d=>{const s=subj(d.sid),n=str(d.name,80);if(!s||!n)bad("Noto'g'ri ma'lumot");s.cats.push({id:uid(),name:n})},
    delCat:d=>{const s=subj(d.sid);if(!s)return;s.cats=s.cats.filter(c=>c.id!==d.cid);db.questions=db.questions.filter(q=>q.catId!==d.cid)},
    addUser:d=>{const n=str(d.name,80),l=str(d.login,40),p=str(d.pass,100);
      if(!n||!l||!p||!["teacher","student"].includes(d.role))bad("Noto'g'ri ma'lumot");
      if(db.users.some(u=>u.login===l))bad("Bu login band.");
      if(d.role==="student"&&!db.users.some(u=>u.id===d.teacherId&&u.role==="teacher"))bad("O'qituvchi topilmadi");
      db.users.push({id:uid(),name:n,login:l,pass:hash(p),role:d.role,teacherId:d.role==="student"?d.teacherId:undefined})},
    delUser:d=>{const u=db.users.find(x=>x.id===d.id);if(!u||u.role==="admin")return;
      const gone=new Set([u.id,...db.users.filter(x=>x.teacherId===u.id).map(x=>x.id)]);
      db.users=db.users.filter(x=>!gone.has(x.id));db.questions=db.questions.filter(q=>!gone.has(q.teacherId));
      db.results=db.results.filter(r=>!gone.has(r.studentId));for(const t in db.sessions)if(gone.has(db.sessions[t]))delete db.sessions[t]}
  },
  teacher:{
    addQ:(d,u)=>{const s=subj(d.subjectId),t=str(d.text,1000);
      if(!s||!s.cats.some(c=>c.id===d.catId)||!t||!Array.isArray(d.opts)||d.opts.length!==4||d.opts.some(o=>!str(o,300))||![0,1,2,3].includes(d.ans))bad("Savol ma'lumotlari noto'g'ri");
      db.questions.push({id:uid(),teacherId:u.id,subjectId:d.subjectId,catId:d.catId,text:t,opts:d.opts.map(o=>o.trim()),ans:d.ans})},
    delQ:(d,u)=>{db.questions=db.questions.filter(q=>!(q.id===d.id&&q.teacherId===u.id))}
  }
};
async function api(req,res,name){
  const body=await new Promise(r=>{let d="";req.on("data",c=>{d+=c;if(d.length>1e6)req.destroy()});req.on("end",()=>{try{r(JSON.parse(d||"{}"))}catch(e){r({})}})});
  const send=(c,o)=>{res.writeHead(c,{"Content-Type":"application/json"});res.end(JSON.stringify(o))};
  try{
    if(name==="login"){
      const u=db.users.find(x=>x.login===body.login);
      if(!u||typeof body.pass!=="string"||!check(body.pass,u.pass))return send(401,{error:"Login yoki parol noto'g'ri."});
      const t=crypto.randomBytes(24).toString("hex");db.sessions[t]=u.id;save();return send(200,{token:t});
    }
    const u=db.users.find(x=>x.id===db.sessions[req.headers.authorization]);
    if(!u)return send(401,{error:"Kirish kerak"});
    if(name==="logout"){delete db.sessions[req.headers.authorization];save();return send(200,{})}
    if(name==="state")return send(200,state(u));
    if(name==="act"){const f=(acts[u.role]||{})[body.a];if(!f)return send(403,{error:"Ruxsat yo'q"});f(body,u);save();return send(200,{})}
    if(name==="submit"&&u.role==="student"){
      const qs=db.questions.filter(q=>q.teacherId===u.teacherId&&Array.isArray(body.qids)&&body.qids.includes(q.id));
      if(!qs.length||!subj(body.subjectId))bad("Savollar topilmadi");
      const a=body.answers||{},key={};let score=0;qs.forEach(q=>{key[q.id]=q.ans;if(a[q.id]===q.ans)score++});
      db.results.push({studentId:u.id,subjectId:body.subjectId,catId:body.catId||"",score,total:qs.length,date:new Date().toLocaleString("uz-UZ")});save();
      return send(200,{score,total:qs.length,key});
    }
    send(404,{error:"Topilmadi"});
  }catch(e){send(e.code||500,{error:e.msg||"Server xatosi"});if(!e.code)console.error(e)}
}
const MIME={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png"};
http.createServer((req,res)=>{
  const url=decodeURIComponent(req.url.split("?")[0]);
  if(req.method==="POST"&&url.startsWith("/api/"))return api(req,res,url.slice(5));
  const f=path.normalize(path.join(PUB,url==="/"?"index.html":url));
  if(!f.startsWith(PUB)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end("Topilmadi")}
  res.writeHead(200,{"Content-Type":MIME[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(res);
}).listen(PORT,()=>console.log("Sayt ishga tushdi: http://localhost:"+PORT));
