import subprocess,json,pathlib
out=pathlib.Path('/tmp/coko-conversation-detail/ticket-13/.scratch/conversation-detail/evidence/13')
def ab(session,*args):
 p=subprocess.run(['rtk','proxy','agent-browser','--session',session,*args],capture_output=True,text=True,check=True)
 return p.stdout.strip()
def ev(session,code):
 v=json.loads(ab(session,'eval',code));return json.loads(v) if isinstance(v,str) else v
def wait(session,code):return ab(session,'wait','--fn',code)
style="""(selector)=>{const e=document.querySelector(selector);if(!e)return null;const c=getComputedStyle(e),r=e.getBoundingClientRect();return {selector,x:r.x,y:r.y,width:r.width,height:r.height,font:c.font,color:c.color,background:c.backgroundColor,radius:c.borderRadius,cornerShape:c.cornerShape,border:c.border,shadow:c.boxShadow,padding:c.padding,gap:c.gap}}"""
metrics=[]
for theme in ['light','dark']:
 for locale in ['en','zh']:
  for width in [1000,390]:
   for session in ['coko-integrated-13','coko-reference-13']:
    ab(session,'set','viewport',str(width),'1200');ab(session,'set','media',theme)
   c='coko-integrated-13';r='coko-reference-13'
   ab(c,'open',f'http://127.0.0.1:60177/?theme={theme}&lang={locale}&state=running')
   wait(c,"document.querySelectorAll('[data-slot=tool-card]').length===5 && document.querySelector('main').clientWidth==="+str(width))
   ab(r,'open',f'http://127.0.0.1:60180/reference.html?theme={theme}&lang={locale}')
   wait(r,"document.querySelectorAll('[aria-expanded=false]').length===6")
   # Actual App and reference source have equal content axes; absolute vertical origin is shell-specific.
   ab(c,'screenshot',str(out/f'coko-{theme}-{locale}-{width}-running.png'))
   ab(r,'screenshot',str(out/f'reference-{theme}-{locale}-{width}-running.png'))
   ab(c,'eval',"document.querySelectorAll('[data-slot=tool-card] >button, .conversation-reasoning button').forEach(e=>e.click());true")
   ab(r,'eval',"document.querySelectorAll('[aria-expanded=false]').forEach(e=>e.click());true")
   wait(c,"document.querySelectorAll('[data-file-token]').length>1")
   wait(r,"document.querySelector('pre')!==null || document.body.innerText.includes('2 tests passed')")
   ab(c,'eval',"document.querySelector('.conversation-message-scroll').scrollTop=0;true")
   ab(c,'screenshot',str(out/f'coko-{theme}-{locale}-{width}-details.png'))
   ab(r,'screenshot',str(out/f'reference-{theme}-{locale}-{width}-details.png'))
   cm=ev(c,'JSON.stringify({axis:document.querySelector("[data-slot=conversation-messages]").clientWidth,main:document.querySelector("main").clientWidth,dpr:devicePixelRatio,mode:document.compatMode,overflow:document.documentElement.scrollWidth>innerWidth,styles:[".conversation-user-message >p","[data-slot=tool-card] >button",".file-detail",".file-detail-header",".file-detail-code","[data-terminal]",".tool-io-card"].map('+style+'),syntax:[...document.querySelectorAll("[data-file-token]")].map(e=>({text:e.textContent,color:getComputedStyle(e).color})),fonts:{sans:getComputedStyle(document.body).fontFamily,code:getComputedStyle(document.querySelector(".file-detail-code")).fontFamily}})')
   rm=ev(r,'JSON.stringify({axis:document.querySelector("main").clientWidth,dpr:devicePixelRatio,mode:document.compatMode,overflow:document.documentElement.scrollWidth>innerWidth,styles:[".user >div","[class*=_title_]","[data-read]","[data-terminal]","[data-diff]"].map('+style+'),font:getComputedStyle(document.body).fontFamily})')
   assert cm['axis']==rm['axis'],(cm['axis'],rm['axis'])
   assert not cm['overflow'] and not rm['overflow'],(theme,locale,width)
   # Finish with focus in the composer so the normal completion rule is observed.
   ab(c,'focus','[role=textbox]');ab(c,'eval','window.finish();true')
   wait(c,"[...document.querySelectorAll('[data-slot=process-seat]')].every(e=>e.hidden)")
   ab(c,'screenshot',str(out/f'coko-{theme}-{locale}-{width}-completed.png'))
   ab(c,'click','[data-slot=run-process-control]');ab(c,'click','[data-slot=process-group-header]')
   wait(c,"document.querySelector('[data-slot=process-group-header]').getAttribute('aria-expanded')==='true'")
   ab(c,'screenshot',str(out/f'coko-{theme}-{locale}-{width}-historical.png'))
   metrics.append(dict(theme=theme,locale=locale,width=width,height=1200,coko=cm,reference=rm))
(out/'composed-metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2))
print('CAPTURED',len(metrics),'environments')
