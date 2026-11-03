import json, subprocess
from pathlib import Path
out = Path(__file__).resolve().parent
def run(*args):
    return subprocess.check_output(['rtk','proxy','agent-browser','--session','coko-history-11',*args],text=True)
metrics = []
for theme in ['light','dark']:
    for width in [1000,390]:
        run('set','viewport',str(width),'900','1')
        run('open',f'http://127.0.0.1:49455/?theme={theme}')
        run('wait','--fn',"document.querySelectorAll('[data-slot=rewound]').length === 2")
        run('focus','[data-slot="rewound"]:not([data-slot="rewound"] [data-slot="rewound"]) > summary')
        run('press','Enter')
        run('focus','[data-slot="rewound"] [data-slot="rewound"] > summary')
        run('press','Enter')
        run('click','[data-slot="rewound"] [data-slot="rewound"] [data-slot="run-process-control"]')
        run('click','[data-slot="rewound"] [data-slot="rewound"] [data-slot="process-group-header"]')
        run('click','[data-slot="rewound"] [data-slot="rewound"] [data-tool="custom"]:first-child > button')
        run('focus','[data-slot="compaction-divider"] > summary')
        run('press','Enter')
        run('eval',"document.querySelector('.conversation-message-scroll').scrollTop=0")
        run('screenshot',str(out/f'{theme}-en-{width}-history.png'))
        run('eval',"document.querySelector('.conversation-message-scroll').scrollTop=document.querySelector('.conversation-message-scroll').scrollHeight")
        run('screenshot',str(out/f'{theme}-en-{width}-readonly.png'))
        data = json.loads(json.loads(run('eval',"JSON.stringify({viewport:innerWidth,dpr:devicePixelRatio,main:document.querySelector('main').clientWidth,overflow:document.querySelector('main').scrollWidth,openHistory:Array.from(document.querySelectorAll('[data-slot=rewound]')).map(x=>x.open),summaryOpen:document.querySelector('[data-slot=compaction-divider]').open,keyboardFocused:document.activeElement?.parentElement?.dataset.slot,groups:Array.from(document.querySelectorAll('[data-slot=process-group-body]')).map(x=>({cap:getComputedStyle(x).maxHeight,client:x.clientHeight,total:x.scrollHeight})),readonlyActions:Array.from(document.querySelectorAll('[data-action=rewind],[data-action=fork]')).map(x=>x.disabled),retry:document.querySelectorAll('[data-run-status=error] button').length})")))
        assert data['main'] == data['overflow'], data
        assert data['openHistory'] == [True,True], data
        assert data['summaryOpen'] and all(data['readonlyActions']) and data['retry']==0, data
        metrics.append({'theme':theme,'locale':'en','width':width,'data':data})
(out/'metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
print('8 actual App captures; 4 theme/width metrics; keyboard history and summary disclosures passed')
