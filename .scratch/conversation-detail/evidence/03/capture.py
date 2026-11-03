import subprocess, json, pathlib
root=pathlib.Path('/tmp/coko-conversation-detail/ticket-03-visual')
def ab(session,*args):
 result=subprocess.run(['rtk','proxy','agent-browser','--session',session,*args],check=True,capture_output=True,text=True)
 return result.stdout
metrics=[]
for theme in ['light','dark']:
 for width in [1000,390]:
  lang='zh' if width==1000 else 'en'
  session='coko-process-03'
  ab(session,'set','viewport',str(width),'900')
  ab(session,'set','media',theme)
  for state in ['running','completed']:
   ab(session,'open',f'http://127.0.0.1:49653/?lang={lang}&theme={theme}&state={state}')
   ab(session,'wait','--fn',"Boolean(document.querySelector('[data-slot=run-process-control]'))")
   if state=='running': ab(session,'wait','--fn',"Boolean(document.querySelector('[data-slot=process-group-body][data-running]'))")
   ab(session,'hover','header h1')
   ab(session,'screenshot',str(root/f'coko-{theme}-{width}-{state}.png'))
   if state=='completed':
    ab(session,'click','[data-slot=run-process-control]')
    ab(session,'screenshot',str(root/f'coko-{theme}-{width}-history-closed.png'))
    ab(session,'click','[data-slot=process-group-header]')
    ab(session,'hover','header h1')
    ab(session,'screenshot',str(root/f'coko-{theme}-{width}-history-open.png'))
   metric=ab(session,'eval',"JSON.stringify({theme:document.documentElement.className,dpr:devicePixelRatio,column:document.querySelector('[data-slot=conversation-messages]').getBoundingClientRect().width,font:getComputedStyle(document.querySelector('[data-slot=process-group-header]')).font,color:getComputedStyle(document.querySelector('[data-slot=process-group-header]')).color,cap:getComputedStyle(document.querySelector('[data-slot=process-group-body]')).maxHeight,overflow:getComputedStyle(document.querySelector('[data-slot=process-group-body]')).overflowY,header:document.querySelector('[data-slot=process-group-header]').getBoundingClientRect().height})")
   metrics.append({'object':'Coko','theme':theme,'width':width,'state':state,'metric':metric})
  session='coko-process-reference-03'
  ab(session,'set','viewport',str(width),'900')
  ab(session,'set','media',theme)
  for state in ['running','completed']:
   ab(session,'open',f'http://127.0.0.1:49766/process.html?lang={lang}&theme={theme}&state={state}')
   ab(session,'wait','--fn',"Boolean(document.querySelector('[data-step-process]'))")
   ab(session,'eval',f"document.querySelector('main').style.maxWidth='{680 if width==1000 else 326}px';true")
   ab(session,'screenshot',str(root/f'reference-{theme}-{width}-{state}.png'))
   if state=='completed':
    ab(session,'click','[data-step-process] button')
    ab(session,'hover','.user')
    ab(session,'screenshot',str(root/f'reference-{theme}-{width}-history-open.png'))
   metric=ab(session,'eval',"JSON.stringify({dpr:devicePixelRatio,column:document.querySelector('main').getBoundingClientRect().width,font:getComputedStyle(document.querySelector('[data-step-process] button')).font,color:getComputedStyle(document.querySelector('[data-step-process] button')).color,cap:getComputedStyle(document.querySelector('[data-step-process-body]')).maxHeight,overflow:getComputedStyle(document.querySelector('[data-step-process-body]')).overflowY,header:document.querySelector('[data-step-process] button').getBoundingClientRect().height})")
   metrics.append({'object':'Reference','theme':theme,'width':width,'state':state,'metric':metric})
(root/'metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2))
print('captured',len(list(root.glob('*.png'))),'PNGs;',len(metrics),'metric records')
