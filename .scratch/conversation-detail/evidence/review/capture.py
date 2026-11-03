import subprocess,json
from pathlib import Path
out=Path('/tmp/coko-conversation-detail/review-fix/.scratch/conversation-detail/evidence/review')
def ab(*a):
 p=subprocess.run(['rtk','proxy','agent-browser','--session','coko-review-fix',*a],text=True,capture_output=True,check=True);return p.stdout
metrics=[]
for theme in ['light','dark']:
 for lang in ['en','zh']:
  for width in [1000,390]:
   tag=f'{theme}-{lang}-{width}'
   ab('set','viewport',str(width+280 if width == 1000 else width),'1000')
   ab('open',f'http://127.0.0.1:65461/?state=running&theme={theme}&lang={lang}')
   ab('wait','--fn','document.querySelector("[data-tool=read] button") !== null')
   ab('eval','document.querySelector("[data-tool=read] button").click()')
   ab('wait','--fn','document.querySelector(".file-detail-expand") !== null')
   ab('screenshot',str(out/f'{tag}-collapsed.png'))
   ab('eval','document.querySelector(".file-detail-expand").focus()')
   ab('press','Enter')
   ab('wait','--fn','document.querySelector(".file-detail-expand").getAttribute("aria-expanded") === "true"')
   metrics.append({'case':tag,'expanded':ab('eval',"JSON.stringify({font:getComputedStyle(document.querySelector('.file-detail-code')).font,header:getComputedStyle(document.querySelector('.file-detail-header')).font,focused:document.activeElement===document.querySelector('.file-detail-expand'),totals:document.querySelector('[data-slot=file-diff-totals]').textContent,mainWidth:document.querySelector('main').getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth})")})
   ab('screenshot',str(out/f'{tag}-expanded.png'))
   ab('press','Enter')
   ab('wait','--fn','document.querySelector(".file-detail-expand").getAttribute("aria-expanded") === "false"')
   metrics[-1]['reclosedFocus']=ab('eval',"document.activeElement===document.querySelector('.file-detail-expand')")
(out/'metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2))
print('captured',len(metrics),'cases')
