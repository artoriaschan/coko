import subprocess, json, pathlib
root = pathlib.Path('/tmp/coko-conversation-detail/ticket-08/.scratch/conversation-detail/evidence/08')
def ab(*args):
    return subprocess.run(['rtk', 'proxy', 'agent-browser', '--session', 'coko-approval-08', *args], check=True, capture_output=True, text=True).stdout
def read_eval(code):
    return json.loads(json.loads(ab('eval', code)))
metrics = []
for theme in ['light', 'dark']:
    for width, lang in [(1000, 'zh'), (390, 'en')]:
        ab('set', 'viewport', str(width), '900')
        for state in ['completed', 'approval', 'confirmation']:
            ab('open', f'http://127.0.0.1:61571/?theme={theme}&lang={lang}&state={state}')
            expected = '[data-slot=approval-card]' if state == 'approval' else '[data-slot=confirmation-card]' if state == 'confirmation' else '[data-slot=run-process-control]'
            ab('wait', '--fn', f'Boolean(document.querySelector("{expected}"))')
            ab('hover', 'header h1')
            ab('screenshot', str(root / f'{theme}-{lang}-{width}-{state}.png'))
            metrics.append({'theme': theme, 'lang': lang, 'width': width, 'state': state, 'metrics': read_eval("JSON.stringify({dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],main:document.querySelector('[data-slot=app-frame-main]').getBoundingClientRect().toJSON(),pageWidth:document.documentElement.scrollWidth,card:document.querySelector('[data-slot=approval-card],[data-slot=confirmation-card]')?.getBoundingClientRect().toJSON(),states:[...document.querySelectorAll('[data-slot=process-tool-states]')].filter(el=>el.getBoundingClientRect().height).map(el=>({text:el.textContent,color:getComputedStyle(el).color,font:getComputedStyle(el).font,rect:el.getBoundingClientRect().toJSON()})),fonts:{noto:document.fonts.check('13px \"Noto Sans SC\"'),jetbrains:document.fonts.check('13px \"JetBrains Mono\"')}})")})
            if state == 'completed':
                ab('click', '[data-slot=run-process-control]')
                ab('click', '[data-slot=process-group-header]')
                ab('focus', '[data-tool=custom] button')
                ab('press', 'Enter')
                ab('wait', '--fn', 'Boolean(document.querySelector("[data-approval-feedback]"))')
                ab('hover', 'header h1')
                ab('screenshot', str(root / f'{theme}-{lang}-{width}-details.png'))
                metrics.append({'theme':theme,'lang':lang,'width':width,'state':'details','metrics':read_eval("JSON.stringify({focused:document.activeElement?.textContent,feedback:document.querySelector('[data-approval-feedback]')?.textContent,pageWidth:document.documentElement.scrollWidth,toolRows:[...document.querySelectorAll('[data-slot=tool-card]')].map(el=>({status:el.dataset.status,rect:el.getBoundingClientRect().toJSON()}))})")})
(root / 'metrics.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2))
print('captured 16 screenshots and',len(metrics),'metric records')
