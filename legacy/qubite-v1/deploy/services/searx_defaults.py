"""Bounded free-engine defaults for a fresh installation (no paid Yandex API)."""
ENGINE_OVERRIDES=[
 {'name':'yandex','disabled':False}, {'name':'yahoo','disabled':False},
 {'name':'google','disabled':True}, {'name':'brave','disabled':True},
 {'name':'currency','disabled':True}, {'name':'lingva','disabled':True},
 {'name':'dictzone','disabled':True}, {'name':'mymemory translated','disabled':True},
 {'name':'google videos','disabled':True}, {'name':'brave.videos','disabled':True},
 {'name':'vimeo','disabled':True},
]
ENGINE_YAML='engines:\n'+''.join('  - name: '+e['name']+'\n    disabled: '+str(e['disabled']).lower()+'\n' for e in ENGINE_OVERRIDES)
