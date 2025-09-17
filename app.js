// Simple client-only lobby system using localStorage to sync between tabs
(function(){
  const VIEWS = {
    HOME: 'view-home',
    HOST: 'view-host-setup',
    JOIN: 'view-join',
    LOBBY: 'view-lobby',
  };

  const els = {
    views: {
      home: byId(VIEWS.HOME),
      host: byId(VIEWS.HOST),
      join: byId(VIEWS.JOIN),
      lobby: byId(VIEWS.LOBBY),
    },
    buttons: {
      host: byId('btn-host'),
      join: byId('btn-join'),
      leave: byId('btn-leave'),
      copyCode: byId('btn-copy-code'),
      start: byId('btn-start'),
    },
    forms: {
      host: byId('form-host'),
      join: byId('form-join'),
    },
    inputs: {
      hostName: byId('host-name'),
      joinName: byId('join-name'),
      joinCode: byId('join-code'),
    },
    errors: {
      host: byId('host-error'),
      join: byId('join-error'),
    },
    lobby: {
      codeBadge: byId('code-badge'),
      playersList: byId('players-list'),
    }
  };

  // Session (per-tab)
  const session = {
    get(){ try { return JSON.parse(sessionStorage.getItem('cah_session')||'null'); } catch { return null; } },
    set(s){ sessionStorage.setItem('cah_session', JSON.stringify(s)); },
    clear(){ sessionStorage.removeItem('cah_session'); },
  };

  // Game store (shared across tabs via localStorage)
  const GameStore = {
    key(code){ return `cah_game_${code}`; },
    get(code){
      const raw = localStorage.getItem(this.key(code));
      if(!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    save(game){
      game.updatedAt = Date.now();
      localStorage.setItem(this.key(game.code), JSON.stringify(game));
    },
    remove(code){ localStorage.removeItem(this.key(code)); },
    exists(code){ return !!localStorage.getItem(this.key(code)); }
  };

  // Utilities
  function byId(id){ return document.getElementById(id); }
  function uid(){ return 'p_' + Math.random().toString(36).slice(2, 10); }
  function nowISO(){ return new Date().toISOString(); }
  function clampName(name){
    if(!name) return '';
    const trimmed = name.trim().replace(/\s+/g, ' ');
    return trimmed.slice(0,20);
  }
  function validateName(name){ return !!name && name.length >= 2 && name.length <= 20; }
  function isSixDigit(code){ return /^\d{6}$/.test(code); }
  function genCode(){
    // 6-digit string with leading zeros allowed, ensure not colliding with existing (try 100 times)
    for(let i=0;i<100;i++){
      const code = String(Math.floor(Math.random()*1_000_000)).padStart(6,'0');
      if(!GameStore.exists(code)) return code;
    }
    // Fallback (very unlikely)
    return String(Math.floor(Math.random()*1_000_000)).padStart(6,'0');
  }
  function copyText(text){
    return navigator.clipboard?.writeText(text).catch(()=>fallbackCopy(text)) ?? fallbackCopy(text);
  }
  function fallbackCopy(text){
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }

  // View handling
  function showView(viewId){
    for(const id of Object.values(VIEWS)){
      const el = byId(id);
      if(!el) continue;
      if(id === viewId) el.classList.remove('hidden');
      else el.classList.add('hidden');
    }
  }

  // Lobby state
  let lobbyCode = null;
  let playerId = null;
  let lobbyUnsubscribe = null;

  function enterLobby(code, pid){
    lobbyCode = code;
    playerId = pid;
    els.lobby.codeBadge.textContent = code;
    renderPlayers();
    if(lobbyUnsubscribe) lobbyUnsubscribe();
    lobbyUnsubscribe = subscribeLobby(code, () => {
      renderPlayers();
    });
    showView(VIEWS.LOBBY);
  }

  function leaveLobby(){
    if(!lobbyCode || !playerId) { resetToHome(); return; }
    const game = GameStore.get(lobbyCode);
    if(game){
      // remove player
      const idx = game.players.findIndex(p=>p.id===playerId);
      if(idx>=0) game.players.splice(idx,1);
      if(game.hostId === playerId){
        // reassign host
        if(game.players.length>0){
          game.hostId = game.players[0].id;
          game.players[0].isHost = true;
        } else {
          // delete empty game
          GameStore.remove(lobbyCode);
        }
      }
      if(game.players && game.players.length>0) GameStore.save(game);
    }
    if(lobbyUnsubscribe){ lobbyUnsubscribe(); lobbyUnsubscribe = null; }
    lobbyCode = null;
    playerId = null;
    session.clear();
    showView(VIEWS.HOME);
  }

  function renderPlayers(){
    const list = els.lobby.playersList;
    list.innerHTML = '';
    const game = lobbyCode ? GameStore.get(lobbyCode) : null;
    if(!game){
      // Game no longer exists
      list.innerHTML = `<li class="player"><span class="name">Lobby is gesloten</span><span class="role">—</span></li>`;
      return;
    }
    const frag = document.createDocumentFragment();
    game.players.forEach(p=>{
      const li = document.createElement('li');
      li.className = 'player';
      const left = document.createElement('span');
      left.className = 'name';
      left.textContent = p.name + (p.id === playerId ? ' (jij)' : '');
      const right = document.createElement('span');
      right.className = 'role';
      right.textContent = p.id === game.hostId ? 'Host' : 'Speler';
      li.appendChild(left);
      li.appendChild(right);
      frag.appendChild(li);
    });
    list.appendChild(frag);
  }

  function subscribeLobby(code, cb){
    const key = GameStore.key(code);
    const handler = (e)=>{
      if(e.key === key){
        cb();
      }
    };
    window.addEventListener('storage', handler);
    // Also refresh every 5s as a safety net
    const interval = setInterval(cb, 5000);
    return ()=>{ window.removeEventListener('storage', handler); clearInterval(interval); };
  }

  // Actions
  els.buttons.host.addEventListener('click', ()=>{
    els.errors.host.textContent = '';
    els.inputs.hostName.value = '';
    showView(VIEWS.HOST);
    els.inputs.hostName.focus();
  });

  els.buttons.join.addEventListener('click', ()=>{
    els.errors.join.textContent = '';
    els.inputs.joinName.value = '';
    els.inputs.joinCode.value = '';
    showView(VIEWS.JOIN);
    els.inputs.joinName.focus();
  });

  document.querySelectorAll('[data-back]').forEach(btn=>{
    btn.addEventListener('click', ()=> showView(VIEWS.HOME));
  });

  els.forms.host.addEventListener('submit', (e)=>{
    e.preventDefault();
    els.errors.host.textContent = '';
    const name = clampName(els.inputs.hostName.value);
    if(!validateName(name)){
      els.errors.host.textContent = 'Geef een naam op (2–20 tekens).';
      els.inputs.hostName.focus();
      return;
    }
    const code = genCode();
    const pid = uid();
    const game = {
      code,
      createdAt: nowISO(),
      updatedAt: Date.now(),
      status: 'lobby',
      hostId: pid,
      players: [{ id: pid, name, isHost: true, joinedAt: nowISO() }],
    };
    GameStore.save(game);
    session.set({ playerId: pid, code, name });
    enterLobby(code, pid);
  });

  els.forms.join.addEventListener('submit', (e)=>{
    e.preventDefault();
    els.errors.join.textContent = '';
    const name = clampName(els.inputs.joinName.value);
    const codeRaw = (els.inputs.joinCode.value||'').trim();
    if(!validateName(name)){
      els.errors.join.textContent = 'Geef een naam op (2–20 tekens).';
      els.inputs.joinName.focus();
      return;
    }
    if(!isSixDigit(codeRaw)){
      els.errors.join.textContent = 'Code moet 6 cijfers zijn.';
      els.inputs.joinCode.focus();
      return;
    }
    const code = codeRaw;
    const game = GameStore.get(code);
    if(!game || game.status !== 'lobby'){
      els.errors.join.textContent = 'Deze lobby bestaat niet (meer).';
      return;
    }
    // Avoid duplicate names (case-insensitive)
    const existsName = game.players.some(p=>p.name.toLowerCase() === name.toLowerCase());
    if(existsName){
      els.errors.join.textContent = 'Deze naam is al in gebruik in de lobby.';
      return;
    }
    const pid = uid();
    game.players.push({ id: pid, name, isHost: false, joinedAt: nowISO() });
    GameStore.save(game);
    session.set({ playerId: pid, code, name });
    enterLobby(code, pid);
  });

  els.buttons.copyCode.addEventListener('click', ()=>{
    if(!lobbyCode) return;
    copyText(lobbyCode);
    const btn = els.buttons.copyCode;
    const old = btn.textContent;
    btn.textContent = 'Gekopieerd!';
    btn.disabled = true;
    setTimeout(()=>{ btn.textContent = old; btn.disabled = false; }, 1200);
  });

  els.buttons.leave.addEventListener('click', ()=>{
    leaveLobby();
  });

  // Startup
  function resetToHome(){
    if(lobbyUnsubscribe){ lobbyUnsubscribe(); lobbyUnsubscribe = null; }
    lobbyCode = null; playerId = null;
    session.clear();
    showView(VIEWS.HOME);
  }

  function initFromSession(){
    const s = session.get();
    if(!s || !s.code || !s.playerId) { showView(VIEWS.HOME); return; }
    const game = GameStore.get(s.code);
    if(!game) { resetToHome(); return; }
    const isStillMember = game.players.some(p=>p.id===s.playerId);
    if(!isStillMember){ resetToHome(); return; }
    lobbyCode = s.code;
    playerId = s.playerId;
    enterLobby(lobbyCode, playerId);
  }

  // If a game becomes empty (from another tab), this tab will see it disappear on next render via renderPlayers()
  initFromSession();
})();