import subprocess,json,pathlib,sys
root=pathlib.Path('/tmp/coko-conversation-detail/ticket-09-visual')
origin=sys.argv[1]
base=['rtk','agent-browser','--session','coko09-business']
def run(*args):
 p=subprocess.run(base+list(args),text=True,capture_output=True,check=True)
 print(' '.join(args[:3]),p.stdout[:180],flush=True)
 return p.stdout
metrics=[]
for theme in ['light','dark']:
 for lang in ['en','zh']:
  for width in [1000,454]:
   run('set','viewport',str(width),'900')
   run('open',f'{origin}?theme={theme}&lang={lang}')
   run('wait','--fn',"document.querySelector('[data-slot=\"run-usage\"]')?.getAttribute('data-tokens') === '42' && document.querySelector('[data-slot=\"app-frame-main\"]')?.getBoundingClientRect().width === innerWidth")
   run('eval',"document.querySelector('.conversation-message-scroll').scrollTop=0")
   run('screenshot',str(root/f'{theme}-{lang}-{width}.png'))
   raw=run('eval',"JSON.stringify({width:innerWidth,rows:[...document.querySelectorAll('.conversation-business-row')].map(el=>({slot:el.dataset.slot,font:getComputedStyle(el).fontFamily,size:getComputedStyle(el).fontSize,line:getComputedStyle(el).lineHeight,width:el.clientWidth,scrollWidth:el.scrollWidth})),mainWidth:document.querySelector('[data-slot=\"app-frame-main\"]').clientWidth,mainScroll:document.querySelector('[data-slot=\"app-frame-main\"]').scrollWidth})")
   metrics.append({'theme':theme,'lang':lang,'width':width,'raw':raw})
root.joinpath('metrics.json').write_text(json.dumps(metrics,indent=2))
