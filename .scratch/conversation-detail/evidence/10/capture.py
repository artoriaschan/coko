import subprocess,json
from pathlib import Path
out=Path('/tmp/coko-conversation-detail/ticket-10/.scratch/conversation-detail/evidence/10')
def run(*args):return subprocess.check_output(['rtk','proxy','agent-browser','--session','coko-collaboration-10',*args],text=True)
metrics=[]
for theme,lang in [('light','en'),('dark','en'),('light','zh'),('dark','zh')]:
 for width in [1280,390]:
  run('set','viewport',str(width),'900','1')
  run('open',f'http://127.0.0.1:63900/?theme={theme}&lang={lang}')
  run('wait','--fn',"document.querySelector('[data-slot=team-task]') !== null && document.querySelector('[data-action=open-agents]') !== null")
  run('screenshot',str(out/f'{theme}-{lang}-{width}-collapsed.png'))
  run('click','[data-slot=process-group-header]')
  run('click','[data-tool=agent] > button')
  run('click','[data-slot=team-message] > button')
  run('click','[data-slot=team-task] > button')
  run('focus','[data-slot=schedule-fire] > button');run('press','Enter')
  run('wait','--fn',"document.querySelector('[data-slot=schedule-prompt]') !== null")
  run('eval',"document.querySelector('.conversation-message-scroll').scrollTop=0")
  run('screenshot',str(out/f'{theme}-{lang}-{width}-expanded.png'))
  run('eval',"document.querySelector('.conversation-message-scroll').scrollTop=document.querySelector('.conversation-message-scroll').scrollHeight")
  run('screenshot',str(out/f'{theme}-{lang}-{width}-sources.png'))
  m=json.loads(run('eval',"JSON.stringify({viewport:innerWidth,dpr:devicePixelRatio,main:document.querySelector('[data-slot=app-frame-main]').getBoundingClientRect().width,overflow:document.documentElement.scrollWidth,rows:[...document.querySelectorAll('[data-slot=tool-card],.conversation-collaboration-trigger')].map(e=>({slot:e.dataset.slot??'business',font:getComputedStyle(e).fontFamily,fontSize:getComputedStyle(e).fontSize,lineHeight:getComputedStyle(e).lineHeight,color:getComputedStyle(e).color,width:e.getBoundingClientRect().width})),agentExpanded:document.querySelector('[data-tool=agent]>button').getAttribute('aria-expanded'),keyboardSource:document.querySelector('[data-slot=schedule-prompt]').textContent})"))
  metrics.append({'theme':theme,'locale':lang,'width':width,'data':json.loads(m)})
(out/'metrics.json').write_text(json.dumps(metrics,indent=2))
print('24 actual App captures;8 theme/language/width metrics;keyboard disclosure passed')
