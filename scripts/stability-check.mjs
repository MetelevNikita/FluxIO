// Run after npm run build && npm test. Only loopback test outputs are used.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createCanvas } from '@napi-rs/canvas';
import { startPlayoutRequestSchema, defaultMpegTsOutputSettings, workspaceSessionSnapshotSchema, graphicEffectAssetSchema } from '../packages/contracts/dist/index.js';
import { initialBroadcastSettings } from '../apps/web/dist-test/default-broadcast-settings.js';
import { scheduleExportRequest } from '../apps/web/dist-test/schedule-export.js';
import { serializeSchedule } from '../apps/media-server/dist/schedule/serializer.js';
import { parseScheduleText } from '../apps/media-server/dist/schedule/parser.js';
const run = promisify(execFile);
const output = path.resolve(process.argv[2] ?? '/tmp/fluxio-stability');
await mkdir(output, { recursive: true });
for (const name of ['AGE', 'Audio']) await mkdir(path.join(output, name), { recursive: true });
const clip = path.join(output, 'test programme.mp4');
const audio = path.join(output, 'Audio', '{eng} test programme.wav');
await run('ffmpeg', ['-v','error','-y','-f','lavfi','-i','testsrc2=size=1280x720:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','12','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',clip]);
await run('ffmpeg', ['-v','error','-y','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','12',audio]);
const canvas = createCanvas(240,80); const ctx = canvas.getContext('2d');
ctx.fillStyle='#063849';ctx.fillRect(0,0,240,80);ctx.fillStyle='#ffffff';ctx.font='bold 30px sans-serif';ctx.fillText('FluxIO TEST',20,48);
const logo = path.join(output,'logo.png'); await writeFile(logo,canvas.toBuffer('image/png'));
ctx.clearRect(0,0,240,80);ctx.fillStyle='#ffffff';ctx.fillText('16+',20,48);
const age = path.join(output,'AGE','16+.png');await writeFile(age,canvas.toBuffer('image/png'));
const template = JSON.parse(await readFile(new URL('../assets/titles/В эфире · угловая метка.fto',import.meta.url),'utf8')).template;
const effect = graphicEffectAssetSchema.parse({ id:'stability-title', name:'Тестовый титр',filePath:'broadcast://dynamic-title',kind:'static',durationSeconds:8,width:1280,height:720,broadcast:{kind:'dynamic-title',scene:template} });
const assets = ['chop','clip','movie'].map((scheduleType,index)=>({
 id:`row-${index}`, name:`${scheduleType} — test programme.mp4`, filePath:clip,
 duration:'00:00:12',durationSeconds:12, declaredDurationSeconds:12, scheduleType,
 codec:'h264',codecFamily:'h264',codecProfile:'High',resolution:'1280x720',fps:'25 fps',bitrate:'4 Mbps',size:'12 MB',status:'analyzed',preview:`/api/media/thumbnail?path=${encodeURIComponent(clip)}`,colorSpace:'bt709',audio:'aac',hasAudio:true,sha256:'fixture',
 ageTitle:{enabled:true,text:'16+',durationSeconds:10,filePath:age},
 itemLogo:{enabled:true,filePath:logo,loop:true,position:'top-right',widthPercent:12,margin:20,opacity:1},
 audioTracks:[{languageCode:'eng',label:'English',filePath:audio,streamIndex:0,durationSeconds:12}],
 scenes:[{id:`show-${index}`,effectId:effect.id,template,fields:{location:'ПРОВЕРКА ЭФИРА'},startSeconds:1,durationSeconds:8}],
 scte35Markers:index===1?[{id:'cue-54321',positionSeconds:4,eventId:54321,kind:'break-start',durationSeconds:4,segmentationTypeId:52,upid:'TEST-54321'}]:[],
}));
const snapshot = workspaceSessionSnapshotSchema.parse({version:2,assets,currentPlaylist:assets,futurePlaylist:[],activeSchedule:'current',selectedAssetId:'row-1',currentScheduleMetadata:null,futureScheduleMetadata:null,scheduleLogoPath:logo,scheduleLogoSource:output,ageLibrary:{directoryPath:path.join(output,'AGE'),imagePaths:[age]},audioTrackLibrary:{directoryPath:path.join(output,'Audio'),languages:[{languageCode:'eng',label:'English',itemCount:3}]},effectLibrary:[effect],subtitleLibrary:null,startMarker:null,settings:{...initialBroadcastSettings, protocol:'UDP',udpHost:'127.0.0.1',udpPort:49310,streamingEnabled:true,autoResumeOnLaunch:false,reserveFilePath:clip,audioTrackDirectory:path.join(output,'Audio'),scte35PlanningEnabled:true,repeatSchedule:false}});
await writeFile(path.join(output,'session.json'),JSON.stringify({snapshot},null,2),{mode:0o600});
const serialized=serializeSchedule(scheduleExportRequest(assets,null,[effect],snapshot.audioTrackLibrary));
await writeFile(path.join(output,'schedule.txt'),serialized.content);
// The same parser used by import must accept the emitted .txt.
const parsed=parseScheduleText(serialized.content,path.join(output,'schedule.txt'));
assert.equal(parsed.items.length,3);
assert.deepEqual(parsed.items.map(item=>item.type),['chop','clip','movie']);
assert.equal(parsed.items[0].audioTracks.length,1);
assert.equal(parsed.items[0].broadcastShows.length,1);
const request=startPlayoutRequestSchema.parse({playlist:assets.map(asset=>({...asset,trimInSeconds:0,trimOutSeconds:12})),video:{codec:'h264',width:1280,height:720,frameRate:25,rateControl:'cbr',targetBitrateKbps:2500,maxBitrateKbps:2500,bufferSizeKbps:5000,crf:20,preset:'ultrafast',profile:'high',level:'4.1',deinterlace:false,fieldOrder:'progressive',gopSize:25,bFrames:0,closedGop:true},audio:{codec:'aac',sampleRate:48000,channels:2,bitrateKbps:128,loudnessNormalization:{enabled:false,targetLufs:-23,truePeakDbtp:-1,loudnessRangeLufs:7}},endpoint:{protocol:'udp',host:'127.0.0.1',port:49310,packetSize:1316,ttl:1,localAddress:'',mpegTs:{...defaultMpegTsOutputSettings,transportBitrateKbps:4000}},audioProgram:{enabled:true,tracks:[{languageCode:'rus',label:'Original',pid:257,source:'original'},{languageCode:'eng',label:'English',pid:258,source:'external'}]},reserveFilePath:clip});
await writeFile(path.join(output,'start-request.json'),JSON.stringify(request,null,2));
if(process.env.FLUXIO_FIXTURES_ONLY==='1'){console.log(output);process.exit(0);}
const ports=(process.env.FLUXIO_PORTS ?? '4310,4311').split(',').map(Number);
const api=async(port,route,body)=>{
 const before=performance.now();const response=await fetch(`http://127.0.0.1:${port}${route}`,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
 const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return {data,ms:performance.now()-before};
};
const samples=[];const delay=monitorEventLoopDelay({resolution:10});delay.enable();
try {
 for(const [index,port] of ports.entries()) await api(port,'/api/playout/start',{...request,endpoint:{...request.endpoint,port:49310+index}});
 const deadline=Date.now()+45000;
 while(Date.now()<deadline){
  const results=await Promise.all(ports.map(port=>api(port,'/api/playout/status')));
  samples.push(results.map(({data,ms})=>({ms,state:data.state,frame:data.frame,fps:data.fps,speed:data.speed,continuityErrors:data.continuityErrors,resources:data.programResources,error:data.error})));
  assert.ok(results.every(({data})=>data.state!=='failed'),JSON.stringify(results));
  if(results.every(({data})=>data.state==='completed')) break;
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert.ok(samples.at(-1).every(sample=>sample.state==='completed'),'Both programmes must finish');
 const latencies=samples.flat().map(sample=>sample.ms).sort((a,b)=>a-b);
 const report={programmes:2,resolution:'1280x720p25',durationSeconds:36,layers:'logo + AGE + native scene + two audio tracks',samples,p95ApiMs:latencies[Math.floor(latencies.length*.95)],maxApiMs:Math.max(...latencies),driverEventLoopP99Ms:delay.percentile(99)/1e6};
 await writeFile(path.join(output,'load-results.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,samples:`${samples.length} samples saved`},null,2));
} finally { delay.disable();for(const port of ports) await api(port,'/api/playout/stop',{}).catch(()=>{}); }
