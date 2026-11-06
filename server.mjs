import express from 'express';
import { WebSocketServer } from 'ws';
import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';
const app=express();app.use(express.static('public'));const server=app.listen(process.env.PORT||3000,'0.0.0.0');const wss=new WebSocketServer({server});
const users=new Map();let connected=false;let lastError='';const username=process.env.TIKTOK_USERNAME||'voxiralive';
function emit(data){const s=JSON.stringify(data);for(const c of wss.clients)if(c.readyState===1)c.send(s)}
function status(){emit({type:'status',connected,username,lastError})}
wss.on('connection',ws=>{ws.send(JSON.stringify({type:'status',connected,username,lastError}));ws.send(JSON.stringify({type:'hello',teams:Object.fromEntries(users)}))});
const conn=new TikTokLiveConnection(username);
function uid(d){return String(d.user?.id||d.user?.displayId||d.uniqueId||'unknown')}
function nick(d){return String(d.user?.displayId||d.user?.nickname||d.uniqueId||'İzleyici').slice(0,30)}
conn.on(WebcastEvent.CHAT,d=>{const msg=String(d.content||d.comment||'').trim().toLocaleLowerCase('tr-TR');const team=msg==='mavi'||msg==='1'?'blue':msg==='kırmızı'||msg==='kirmizi'||msg==='2'?'red':null;if(team){users.set(uid(d),{team,name:nick(d)});emit({type:'join',team,name:nick(d),id:uid(d)})}});
const streaks=new Map();
conn.on(WebcastEvent.GIFT,d=>{const id=uid(d);const u=users.get(id);if(!u)return;const gift=String(d.giftDetails?.giftName||d.extendedGiftInfo?.name||d.giftName||'Hediye');const key=id+':'+String(d.giftId||gift);const count=Math.max(1,Number(d.repeatCount||1));const isStreak=Number(d.giftType)===1;let qty=count;if(isStreak){const old=streaks.get(key)||0;qty=Math.max(0,count-old);streaks.set(key,count);if(d.repeatEnd)streaks.delete(key)}if(!qty)return;qty=Math.min(qty,100);const rose=/rose|gül|gul/i.test(gift);const lion=/lion|aslan/i.test(gift);emit({type:'gift',team:u.team,name:u.name,gift,qty,soldiers:qty*(lion?60:rose?5:15),boss:lion})});
conn.on(WebcastEvent.LIKE,d=>{const u=users.get(uid(d));if(u)emit({type:'like',team:u.team,name:u.name,count:Math.min(50,Number(d.likeCount||1))})});
conn.on(ControlEvent.ERROR,e=>{lastError=String(e?.info||e?.message||'Bağlantı hatası').slice(0,150);status()});
conn.on(ControlEvent.DISCONNECTED,()=>{connected=false;status()});
async function connectLoop(){for(;;){if(!connected){try{await conn.connect();connected=true;lastError='';status()}catch(e){connected=false;lastError=String(e?.message||e).slice(0,150);status()}}await new Promise(r=>setTimeout(r,15000))}}
connectLoop();
