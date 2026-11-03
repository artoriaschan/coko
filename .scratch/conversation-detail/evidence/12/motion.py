import subprocess,json,pathlib
root=pathlib.Path('/tmp/coko-conversation-detail/ticket-12-visual')
def ab(*args): return subprocess.run(['rtk','proxy','agent-browser','--session','coko-reading-12',*args],check=True,capture_output=True,text=True).stdout.strip()
def result(raw):
 value=json.loads(raw)
 return json.loads(value) if isinstance(value,str) else value
ab('set','viewport','1000','800')
ab('set','media','light')
ab('open','http://127.0.0.1:52059/?theme=light&lang=en&state=running')
ab('wait','--fn',"Boolean(document.querySelector('[data-slot=process-group-body][data-running]'))")
ab('scroll','up','1400','--selector','.conversation-message-scroll')
motion=result(ab('eval',"""(async()=>{
 const scroller=document.querySelector('.conversation-message-scroll'),seat=document.querySelector('[data-slot=process-seat]');
 const anchor=[...document.querySelectorAll('.conversation-assistant-message')].find(e=>e.getBoundingClientRect().bottom>scroller.getBoundingClientRect().top);
 const top=anchor.getBoundingClientRect().top,start=performance.now(),frames=[]; window.finish();
 await new Promise((resolve,reject)=>{function frame(now){frames.push({elapsed:now-start,height:seat.getBoundingClientRect().height,scrollTop:scroller.scrollTop,anchorDelta:anchor.getBoundingClientRect().top-top,hidden:seat.hidden}); if(seat.hidden)resolve(); else if(now-start>2000)reject(new Error('fold did not finish'));else requestAnimationFrame(frame)}requestAnimationFrame(frame)});
 return JSON.stringify({frames,finalDelta:anchor.getBoundingClientRect().top-top,animations:seat.getAnimations().length});})()"""))
assert motion['finalDelta']==0,motion
(root/'motion.json').write_text(json.dumps(motion,indent=2))
ab('set','media','dark','reduced-motion')
ab('open','http://127.0.0.1:52059/?theme=dark&lang=en&state=running')
ab('wait','--fn',"Boolean(document.querySelector('[data-slot=process-group-body][data-running]'))")
ab('click','[data-slot=tool-card]:last-child button')
ab('eval','window.finish();true')
ab('wait','--fn',"document.querySelector('[data-slot=run-process-control]').getAttribute('aria-expanded')==='true'")
ab('click','[data-slot=run-process-control]')
reduced=result(ab('eval',"JSON.stringify({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,hidden:document.querySelector('[data-slot=process-seat]').hidden,height:document.querySelector('[data-slot=process-seat]').getBoundingClientRect().height,animations:document.querySelector('[data-slot=process-seat]').getAnimations().length,focused:document.activeElement===document.querySelector('[data-slot=run-process-control]')})"))
assert reduced==dict(reduced=True,hidden=True,height=0,animations=0,focused=True),reduced
(root/'reduced-motion.json').write_text(json.dumps(reduced,indent=2))
print(json.dumps(dict(motion=motion,reduced=reduced)))
