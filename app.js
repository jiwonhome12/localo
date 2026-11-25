/* 로컬로 웹앱 — 지도 API 없이 행정경계 SVG로 그린 반값여행 지도
   data/geo.json          : 시군구 경계 경로(crawler/build_geo.py 로 생성)
   data/regions.json      : 25개 지역 신청 상태·환급 규칙(scripts/build_data.py 가 수집 시트에서 생성)
   data/places.json       : 식당·카페는 수집 시트 실데이터, 숙박·관광지는 아직 예시(sample:true) */
(async function () {
  const $ = (id) => document.getElementById(id);
  const svg = $('svg'), overlay = $('overlay'), wrap = $('mapwrap');
  const NS = 'http://www.w3.org/2000/svg';
  const mobile = () => matchMedia('(max-width:1023px)').matches;
  const won = (n) => Math.round(n).toLocaleString('ko-KR') + '원';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const [GEO, REG, PLACES] = await Promise.all(
    ['data/geo.json', 'data/regions.json', 'data/places.json'].map((u) => fetch(u).then((r) => r.json()))
  );

  const STL = { open: '신청접수중', soon: '준비중', closed: '마감' };
  const CAT = {
    food: { n: '식당', c: 'var(--c-food)', k: '식' }, stay: { n: '숙박', c: 'var(--c-stay)', k: '숙' },
    cafe: { n: '카페', c: 'var(--c-cafe)', k: '카' }, spot: { n: '관광지', c: 'var(--c-spot)', k: '관' },
  };
  const SIDO_ORDER = ['강원', '충북', '충남', '경북', '경남', '전북', '전남'];

  // 지역 = 상태 + 지리 정보
  const R = REG.map((r) => ({ ...r, ...GEO.regions[r.id], short: r.name.slice(0, -1), name: r.name, sido: r.sido }));
  const RM = Object.fromEntries(R.map((r) => [r.id, r]));
  const PM = Object.fromEntries(PLACES.map((p) => [p.id, p]));
  const placesOf = (rid) => PLACES.filter((p) => p.region_id === rid);
  $('checked').textContent = (REG[0].status_checked_at || '').split(' ')[0];

  // 본토가 화면 가로 가운데에 오도록 보기 영역을 좌우 대칭으로 넓힌다(동쪽 울릉도·독도 상자도 그대로 보이게)
  const VB0 = (() => {
    const tmp = document.createElementNS(NS, 'path'); tmp.setAttribute('d', GEO.mainland); svg.appendChild(tmp);
    const b = tmp.getBBox(); tmp.remove();
    const [x, y, w, h] = GEO.viewBox, cx = b.x + b.width / 2, half = Math.max(cx - x, x + w - cx) + 6;
    return [cx - half, y, half * 2, h];
  })();
  let vb = VB0.slice();
  const S = { view: 'all', rid: null, cat: 'all', pid: null, filter: 'all', people: 2, mode: 'normal', cart: [], route: null, basket: 'all', order: {}, panel: null, cmpF: 'avail', cmpMore: false };

  /* ───────── 이 기기 저장소(시제품). 로그인·알림·지난 여행·커뮤니티 글은 나중에 Supabase로 옮긴다 ───────── */
  const KEY = 'localo.v1';
  const DB = (() => { try { return { user: null, alarms: {}, trips: [], posts: [], likes: {}, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { return { user: null, alarms: {}, trips: [], posts: [], likes: {} }; } })();
  const CLOUD = window.LocaloCloud || null; // cloud.js → Supabase. 없으면 이 기기 저장(시제품)
  // 서버를 쓸 때는 이 기기 사본을 남기지 않는다(로그인 데이터는 서버가 원본)
  const save = () => { if (CLOUD) return; try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { /* 저장 불가(사생활 보호 모드 등) — 화면은 그대로 동작 */ } };
  // 서버 작업: 실패하면 알리고 서버 상태로 다시 맞춘다
  async function cloud(fn, fail = '저장하지 못했어요. 잠시 후 다시 해 주세요') {
    if (!CLOUD) return true;
    try { return await fn(CLOUD); } catch (e) { console.warn(e); toast(fail); refreshCloud(); return false; }
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const today = () => new Date().toISOString().slice(0, 10);
  // 로그인이 필요한 기능: 로그인 안 했으면 마이 탭으로 보내고 false
  function needLogin(what) {
    if (DB.user) return true;
    toast(`${what}은 로그인 후 사용할 수 있어요`); openPanel('my'); return false;
  }

  /* ───────── SVG 그리기 ───────── */
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const targetCodes = new Set(R.map((r) => r.code));
  GEO.munis.forEach((m) => { if (!targetCodes.has(m.code)) $('g-munis').appendChild(el('path', { d: m.d, class: 'muni' })); });
  GEO.provinces.forEach((p) => {
    $('g-shadow').appendChild(el('path', { d: p.d, class: 'shadow' })); // 땅 아래 살짝 어긋난 그림자 → 종이를 오려 붙인 느낌
    $('g-prov').appendChild(el('path', { d: p.d, class: 'prov' }));
  });
  // 마감 → 준비중 → 접수중 순으로 그려 접수중 지역이 위에 오게
  const ORDER = { closed: 0, soon: 1, open: 2 };
  [...R].sort((a, b) => ORDER[a.status] - ORDER[b.status]).forEach((r) => { const p = el('path', { d: r.d, class: 'target st-' + r.status, 'data-r': r.id }); $('g-targets').appendChild(p); r.el = p; });
  const deco = $('g-deco');
  [['동 해', 395, 250], ['서 해', 8, 300], ['남 해', 300, 520]].forEach(([t, x, y]) => { const s = el('text', { x, y, class: 'sea' }); s.textContent = t; deco.appendChild(s); });
  const [ix0, iy0, ix1, iy1] = GEO.inset;
  deco.appendChild(el('rect', { x: ix0, y: iy0, width: ix1 - ix0, height: iy1 - iy0, rx: 4, class: 'inset-box' }));
  const it = el('text', { x: ix0 + 4, y: iy1 - 4, class: 'inset-t' }); it.textContent = '울릉도·독도'; deco.appendChild(it);
  svg.addEventListener('click', (e) => { const t = e.target.closest('.target'); if (t) openRegion(t.dataset.r); });

  /* ───────── 좌표 변환 ───────── */
  function proj(x, y) {
    const w = wrap.clientWidth, h = wrap.clientHeight, s = Math.min(w / vb[2], h / vb[3]);
    return [(w - vb[2] * s) / 2 + (x - vb[0]) * s, (h - vb[3] * s) / 2 + (y - vb[1]) * s, s];
  }
  function setVB(v) { vb = v; svg.setAttribute('viewBox', v.join(' ')); placeOverlay(); }
  let anim = null;
  function animateVB(to, ms = 650, done) {
    cancelAnimationFrame(anim);
    const from = vb.slice(), t0 = performance.now();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setVB(to); done && done(); return; }
    const step = (t) => { let k = Math.min(1, (t - t0) / ms); k = 1 - Math.pow(1 - k, 3);
      setVB(from.map((f, i) => f + (to[i] - f) * k)); if (k < 1) anim = requestAnimationFrame(step); else done && done(); };
    anim = requestAnimationFrame(step);
  }
  // 지역 경계 상자에 맞춰 확대 (화면 비율 유지)
  function fitBox([x0, y0, x1, y1], pad = 0.28) {
    const w = wrap.clientWidth || 1, h = wrap.clientHeight || 1;
    let bw = (x1 - x0) * (1 + pad * 2), bh = (y1 - y0) * (1 + pad * 2);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 - (mobile() ? 0 : 0);
    if (bw / bh > w / h) bh = bw * h / w; else bw = bh * w / h;
    return [cx - bw / 2, cy - bh / 2 - bh * 0.04, bw, bh];
  }

  /* ───────── 지도 위 HTML(핀·라벨·마커) ───────── */
  let pinOffsets = {}; // 전국 화면 라벨 겹침 해소 결과 (px)
  function renderOverlay() {
    let h = '<svg class="leaders" id="leaders"></svg>';
    if (S.view === 'all') {
      R.forEach((r, i) => {
        if (S.filter !== 'all' && r.status !== S.filter) return;
        const d = (2.55 + i * 0.03).toFixed(2);
        h += `<span class="pdot ${r.status}" data-r="${r.id}" style="animation-delay:${d}s"></span>`;
        if (r.status === 'closed' && S.filter === 'all') return; // 깔끔하게: 마감 지역은 점만
        h += `<button type="button" class="pin hit ${r.status}" data-r="${r.id}" style="animation-delay:${d}s" aria-label="${r.name} ${STL[r.status]}"><span class="pd"></span>${r.short}</button>`;
      });
    } else {
      const r = RM[S.rid];
      GEO.munis.forEach((m) => { if (m.code !== r.code) h += `<span class="nlabel" data-x="${m.cx}" data-y="${m.cy}">${m.name}</span>`; });
      h += `<span class="rlabel" data-x="${r.cx}" data-y="${r.cy}">${r.short}</span>`;
      placesOf(r.id).forEach((p) => {
        if (S.cat !== 'all' && p.category !== S.cat) return;
        const inCart = S.cart.some((c) => c.pid === p.id);
        const ord = S.route ? S.route.indexOf(p.id) : -1;
        h += `<button type="button" class="marker hit${S.pid === p.id ? ' on' : ''}${inCart ? ' in-cart' : ''}" data-p="${p.id}" aria-label="${esc(p.name)}">${ord >= 0 ? `<span class="ord">${ord + 1}</span>` : ''}<span class="mk" style="background:${CAT[p.category].c}"><i>${CAT[p.category].k}</i></span><span class="ml">${esc(p.name.replace(r.short + ' ', ''))}</span></button>`;
      });
      if (S.pid) h += popHTML(PM[S.pid]);
    }
    overlay.innerHTML = h;
    if (S.view === 'all') layoutPins();
    placeOverlay();
  }
  // 라벨끼리 겹치지 않게 밀어내고, 많이 움직인 라벨은 지시선을 그린다
  function layoutPins() {
    const vb0 = vb; vb = VB0; // 전국 화면 기준으로 계산
    const items = [...overlay.querySelectorAll('.pin')].map((b) => {
      const r = RM[b.dataset.r]; const [x, y] = proj(r.cx, r.cy);
      return { id: r.id, ax: x, ay: y, x, y: y - 16, w: b.offsetWidth + 4, h: b.offsetHeight + 4 };
    });
    const W = wrap.clientWidth, H = wrap.clientHeight;
    for (let it = 0; it < 140; it++) {
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        const ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x), oy = (a.h + b.h) / 2 - Math.abs(a.y - b.y);
        if (ox > 0 && oy > 0) {
          if (ox < oy * 1.6) { const s = (a.x < b.x ? -1 : 1) * ox / 2; a.x += s; b.x -= s; }
          else { const s = (a.y < b.y ? -1 : 1) * oy / 2; a.y += s; b.y -= s; }
        }
      }
      items.forEach((a) => { a.x += (a.ax - a.x) * 0.03; a.y += (a.ay - 16 - a.y) * 0.03;
        a.x = Math.max(a.w / 2 + 6, Math.min(W - a.w / 2 - 6, a.x)); a.y = Math.max(60, Math.min(H - 40, a.y)); });
    }
    pinOffsets = Object.fromEntries(items.map((a) => [a.id, [a.x - a.ax, a.y - a.ay]]));
    vb = vb0;
  }
  function placeOverlay() {
    const L = overlay.querySelector('#leaders'); let lines = '';
    overlay.querySelectorAll('.pdot').forEach((e) => { const r = RM[e.dataset.r]; const [x, y] = proj(r.cx, r.cy); e.style.left = x + 'px'; e.style.top = y + 'px'; });
    overlay.querySelectorAll('.pin').forEach((e) => {
      const r = RM[e.dataset.r]; const [x, y] = proj(r.cx, r.cy); const o = pinOffsets[r.id] || [0, -16];
      e.style.left = x + o[0] + 'px'; e.style.top = y + o[1] + 'px';
      if (Math.hypot(o[0], o[1]) > 20) lines += `<line x1="${x}" y1="${y}" x2="${x + o[0]}" y2="${y + o[1]}"/>`;
    });
    if (L) L.innerHTML = lines;
    overlay.querySelectorAll('.nlabel,.rlabel').forEach((e) => { const [x, y] = proj(+e.dataset.x, +e.dataset.y); e.style.left = x + 'px'; e.style.top = y + 'px'; });
    overlay.querySelectorAll('.marker').forEach((e) => { const p = PM[e.dataset.p]; const [x, y] = proj(p.x, p.y); e.style.left = x + 'px'; e.style.top = y + 'px'; });
    const pop = overlay.querySelector('.pop');
    if (pop && !mobile()) {
      const p = PM[pop.dataset.p]; const [x, y] = proj(p.x, p.y);
      const w = wrap.clientWidth, h = wrap.clientHeight, pw = pop.offsetWidth, ph = pop.offsetHeight;
      let L2 = x + 24, T = y - ph / 2;
      if (L2 + pw > w - 12) L2 = x - pw - 24;
      if (L2 < 12) { L2 = Math.max(12, Math.min(w - pw - 12, x - pw / 2)); T = y + 12 + ph < h ? y + 12 : y - ph - 44; }
      pop.style.left = L2 + 'px'; pop.style.top = Math.max(56, Math.min(h - ph - 8, T)) + 'px';
    }
  }
  const safeUrl = (u) => (/^https?:\/\//.test(u || '') ? esc(u) : '');
  function popHTML(p) {
    const r = RM[p.region_id], inCart = S.cart.some((c) => c.pid === p.id);
    const q = encodeURIComponent(r.name + ' ' + (p.sample ? CAT[p.category].n : p.name));
    const map = safeUrl(p.map_url) || `https://map.kakao.com/link/search/${q}`;
    const rows = p.sample
      ? `<dt>가격</dt><dd>${esc(p.price_text)}</dd><dt>접근성</dt><dd>${esc(p.access_text)}</dd>`
      : `<dt>대표 메뉴</dt><dd>${esc(p.price_text)}</dd><dt>주소</dt><dd>${esc(p.address || p.access_text)}</dd>

         <dt>가맹점</dt><dd>${p.merchant === '예' ? '지역화폐 가맹점' : p.merchant === '아니오' ? '<b class="warn">가맹점 아님 · 환급 제외</b>' : '<span class="warn">확인 전</span>'}</dd>`;
    return `<div class="pop" data-p="${p.id}" role="dialog" aria-label="${esc(p.name)}">
      <button class="x" type="button" data-close aria-label="닫기">✕</button>
      <div class="cat-l" style="color:${CAT[p.category].c}">${CAT[p.category].n} · ${r.name}</div>
      <h3>${esc(p.name)}</h3>
      <dl>${rows}</dl>
      <div class="links"><a href="${map}" target="_blank" rel="noopener">카카오맵에서 보기</a>${safeUrl(p.source_url) ? `<a href="${safeUrl(p.source_url)}" target="_blank" rel="noopener">출처</a>` : ''}</div>
      <button class="btn${inCart ? ' added' : ''}" type="button" data-add="${p.id}">${inCart ? '담김 · 빼기' : '장바구니에 담기'}</button>
      ${p.sample ? '<div class="ex">예시 장소</div>' : ''}</div>`;
  }

  /* ───────── 지도 상단 ───────── */
  function renderTop() {
    const t = $('maptop');
    if (S.view === 'all') {
      const cnt = (k) => (k === 'all' ? R.length : R.filter((r) => r.status === k).length);
      const f = [['all', '전체'], ['open', '신청접수중'], ['soon', '준비중'], ['closed', '마감']];
      t.innerHTML = `<div class="fchips" role="group" aria-label="신청 상태로 거르기">${f.map(([k, n]) => `<button type="button" class="fchip ${k}" data-f="${k}" aria-pressed="${S.filter === k}">${k !== 'all' ? `<span class="dot ${k}"></span>` : ''}${n} <span class="c num">${cnt(k)}</span></button>`).join('')}</div>`;
      return;
    }
    const r = RM[S.rid];
    const cats = [['all', '전체'], ...Object.entries(CAT).map(([k, v]) => [k, v.n])];
    t.innerHTML = `<div class="crumb"><button type="button" data-home>전국</button> › <b>${r.sido} ${r.name}</b></div>
      <div class="cats">${cats.map(([k, n]) => `<button type="button" class="cat" data-cat="${k}" aria-pressed="${S.cat === k}">${k !== 'all' ? `<span class="sw" style="background:${CAT[k].c}"></span>` : ''}${n}</button>`).join('')}</div>`;
  }

  /* ───────── 왼쪽 탭(휴대폰: 아래 시트) ───────── */
  function silhouette(r) {
    const [x0, y0, x1, y1] = r.bbox, w = x1 - x0, h = y1 - y0, s = Math.max(w, h) * 1.08;
    return `<svg viewBox="${x0 + w / 2 - s / 2} ${y0 + h / 2 - s / 2} ${s} ${s}" aria-hidden="true"><path d="${r.d}"/></svg>`;
  }
  function geoFacts(r) {
    const f = [`면적 <b>${r.area_km2.toLocaleString()}㎢</b>`];
    f.push(r.coastal ? '바다와 맞닿은 <b>해안 지역</b>' : '바다가 없는 <b>내륙 지역</b>');
    if (r.parts > 1) f.push(`섬 <b>${r.parts - 1}개</b> 포함`);
    return f.map((x) => `<span class="fact">${x}</span>`).join('');
  }
  const brief = (s, n = 90) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  function capText(k) { return k.cap_1 == null || k.cap_group == null ? '확인 필요' : `1인 ${won(k.cap_1)} · 2인 이상 ${won(k.cap_group)}`; }
  function minText(m) { return !m ? '확인 필요' : m.per_person ? `1인당 ${won(m.one)}` : m.one === m.group ? `${won(m.one)} 이상` : `1인 ${won(m.one)} · 2인 이상 ${won(m.group)}`; }
  function regionInfo(r) {
    const k = r.rule, dl = (rows) => `<dl>${rows.filter((x) => x[1]).map(([t, d]) => `<dt>${t}</dt><dd>${esc(d)}</dd>`).join('')}</dl>`;
    // 깔끔하게: 꼭 필요한 3줄만 보이고 나머지는 '자세히'
    return `<div class="src rinfo">${dl([['일정', r.round || r.period], ['환급 한도', capText(k)], ['최소 소비', minText(k.min_spend)]])}
      <details class="more-info"><summary>자세히</summary>${dl([['사업 기간', r.period], ['청년·가족', brief(r.perks_text) || '확인 필요'], ['환급 수단', r.currency], ['사전신청', brief(r.apply)]])}
      <p class="ex">${esc(r.status_checked_at)} 확인 · 최종 조건은 지자체 공고 기준${r.tour_resident_card ? ' · <span class="star">★</span> 관광주민증 혜택' : ''}</p></details>
      ${safeUrl(r.site) ? `<a href="${safeUrl(r.site)}" target="_blank" rel="noopener">신청 페이지 ›</a>` : ''}</div>`;
  }
  function renderLeft() {
    const L = $('left');
    if (S.view === 'all') {
      let h = `<p class="p-title">반값여행 지역${S.filter !== 'all' ? ` · ${STL[S.filter]}` : ''}</p>`;
      SIDO_ORDER.forEach((sd) => {
        const rs = R.filter((r) => r.sido === sd && (S.filter === 'all' || r.status === S.filter)); if (!rs.length) return;
        h += `<div class="rgroup">${sd}</div>` + rs.map((r) => `<button type="button" class="ritem" data-r="${r.id}"><span class="dot ${r.status}"></span><span class="nm">${r.name}</span>${DB.alarms[r.id] ? '<span class="bell-on" title="신청 알림 받는 중">🔔</span>' : ''}<span class="st ${r.status}">${STL[r.status]}</span></button>`).join('');
      });
      L.innerHTML = h; return;
    }
    const r = RM[S.rid];
    const ps = placesOf(r.id).filter((p) => S.cat === 'all' || p.category === S.cat);
    const cats = [['all', '전체'], ...Object.entries(CAT).map(([k, v]) => [k, v.n])];
    L.innerHTML = `<button type="button" class="back" data-home>← 전국 지도</button>
      <div class="rcard"><div class="sil">${silhouette(r)}</div>
        <div class="rc-main"><div class="rhead"><h2>${r.name}</h2><span class="pill ${r.status}">${STL[r.status]}</span>${alarmBtn(r)}</div>
        <div class="rsub">${r.sido}</div></div></div>
      ${regionInfo(r)}
      <div class="tabs" role="tablist">${cats.map(([k, n]) => `<button type="button" class="tab" role="tab" data-cat="${k}" aria-selected="${S.cat === k}">${n}</button>`).join('')}</div>
      <div>${ps.map((p) => `<button type="button" class="pitem${S.pid === p.id ? ' on' : ''}" data-p="${p.id}"><span class="pic" style="background:${CAT[p.category].c}">${CAT[p.category].k}</span><span><span class="nm">${esc(p.name.replace(r.short + ' ', ''))}</span><span class="sub">${p.price_text} · ${p.access_text}</span></span></button>`).join('')}</div>`;
  }
  // 장바구니는 '가는 지역'별 바구니로 나눈다
  const groups = () => { const g = {}; S.cart.forEach((c) => { const rid = PM[c.pid].region_id; (g[rid] = g[rid] || []).push(c); }); return g; };
  function renderBadge() { const n = S.cart.length, b = $('badge'); b.hidden = !n; b.textContent = n; }

  /* ───────── 신청 알림: 알림을 켠 지역이 '신청접수중'이 되면 알려 준다 ───────── */
  function alarmBtn(r) {
    const on = !!DB.alarms[r.id], locked = !DB.user; // 여행지 알림은 로그인한 사람만
    return `<button type="button" class="alarm${on ? ' on' : ''}${locked ? ' locked' : ''}" data-alarm="${r.id}" aria-pressed="${on}" title="${locked ? '로그인 후 사용할 수 있어요' : r.status === 'open' ? '신청 상태가 바뀌면 알림' : '신청 시작 알림'}">
      <svg viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0" fill="none" stroke-linecap="round"/></svg>${on ? '알림 켜짐' : '신청 알림'}${locked ? '<span class="lk">로그인</span>' : ''}</button>`;
  }
  function toggleAlarm(rid) {
    if (!needLogin('신청 알림')) return;
    const r = RM[rid];
    if (DB.alarms[rid]) { delete DB.alarms[rid]; toast(`${r.name} 알림을 껐어요`); cloud((c) => c.delAlarm(rid)); }
    else {
      DB.alarms[rid] = { status: r.status, at: today() }; cloud((c) => c.setAlarm(rid, r.status));
      toast(r.status === 'open' ? `${r.name}은 지금 신청 중이에요. 상태가 바뀌면 알려 드릴게요` : `${r.name} 신청이 시작되면 알려 드릴게요`);
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
    }
    save(); renderLeft(); if (S.panel === 'my') renderMy();
  }
  // 앱을 열 때: 알림 켠 지역의 상태가 바뀌었으면 알린다(앱을 닫아도 오는 푸시는 Supabase + 웹 푸시 연결 후)
  function checkAlarms() {
    const changed = Object.entries(DB.alarms).filter(([rid, a]) => RM[rid] && RM[rid].status !== a.status);
    changed.forEach(([rid]) => {
      const r = RM[rid], msg = r.status === 'open' ? `${r.name} 반값여행 신청이 시작됐어요` : `${r.name} 신청 상태가 '${STL[r.status]}'(으)로 바뀌었어요`;
      DB.alarms[rid].status = r.status; cloud((c) => c.setAlarm(rid, r.status));
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification('로컬로', { body: msg, icon: 'icons/icon-192.png' }); } catch (e) { /* 일부 브라우저는 페이지에서 직접 알림 불가 */ }
      setTimeout(() => toast(msg), 3200);
    });
    if (changed.length) save();
  }

  /* ───────── 경비 계산 ───────── */
  function nights() { const n = Math.round((new Date($('d2').value) - new Date($('d1').value)) / 864e5); return isNaN(n) ? 1 : Math.max(0, n); }
  // 수량 = 인분·잔·매(식당·카페·관광지) / 객실 수(숙박). 인원을 바꾸면 수량도 같이 바뀐다.
  const UNIT = { food: '인분', cafe: '잔', spot: '매', stay: '실' };
  const roomsFor = (p, ppl) => Math.ceil(ppl / (p.capacity || 2));
  const defaultQty = (p) => (p.category === 'stay' ? roomsFor(p, S.people) : S.people);
  const pplOf = (c) => (c.who == null ? S.people : Math.min(c.who, S.people)); // 이 장소에 가는 사람 수
  const qtyOf = (c) => (PM[c.pid].category === 'stay' ? c.qty : pplOf(c));
  function lineCost(c) {
    const p = PM[c.pid];
    if (p.category === 'stay') { const n = Math.max(1, nights()); return { amt: p.price * n * c.qty, f: `1박 ${won(p.price)} × ${n}박 × 객실 ${c.qty}` }; }
    const q = qtyOf(c);
    if (!p.price) return { amt: 0, f: `무료 · ${q}명` };
    return { amt: p.price * q, f: `${won(p.price)} × ${q}명` };
  }
  function setPeople(n) {
    const old = S.people; S.people = Math.max(1, Math.min(10, n)); $('pp').textContent = S.people + '명';
    S.cart.forEach((c) => { const p = PM[c.pid];
      if (p.category === 'stay') c.qty = roomsFor(p, S.people);
      else if (c.who != null && c.who >= S.people) c.who = null; }); // 일부만 인원이 전체 이상이 되면 다 같이로
    renderStack();
  }
  // 지역별 규칙(수집 시트 → regions.json rule): 일반 50%·지역 한도, 청년 70%·1인 14만(최대 2인), 가족 50%·1인 10만(최대 5인)
  const MODE = { normal: '일반', youth: '청년', family: '가족' };
  function rule(rid) {
    const k = RM[rid].rule, n = S.people, m = k.min_spend;
    const need = !m ? null : m.per_person ? m.one * n : n >= 2 ? m.group : m.one;
    const tag = (s) => (s === 'yes' ? '' : ' · 조건 확인 필요');
    if (S.mode === 'youth' && k.youth !== 'no') return { rate: 0.7, cap: 140000 * Math.min(n, k.youth_max || 2), need, label: '청년 70%' + tag(k.youth) };
    if (S.mode === 'family' && k.family !== 'no' && n >= 2) return { rate: 0.5, cap: 100000 * Math.min(n, 5), need, label: '가족 50%' + tag(k.family) };
    const why = S.mode === 'family' && n < 2 ? ' · 가족은 2인 이상' : S.mode !== 'normal' ? ' · 우대 없음' : '';
    return { rate: k.rate, cap: n >= 2 ? k.cap_group : k.cap_1, need, label: '일반 50%' + why };
  }
  function refundOf(rid, sub) {
    const ru = rule(rid);
    if (ru.cap == null) return { v: 0, ru, why: '한도 확인 필요' };
    if (ru.need != null && sub < ru.need) return { v: 0, ru, why: `최소 ${won(ru.need)} 미달` };
    return { v: Math.min(sub * ru.rate, ru.cap), ru, why: ru.need == null ? '최소 소비 확인 필요' : '' };
  }
  // 스와이프 스위치: 왼쪽 = 다 같이(여행 인원 그대로), 오른쪽 = 일부만(인원 직접)
  function whoHTML(c) {
    const custom = c.who != null, n = pplOf(c);
    return `<div class="who${custom ? ' custom' : ''}" data-who="${c.pid}" role="group" aria-label="이 장소에 가는 인원">
      <div class="who-track"><button type="button" class="who-opt" data-who-set="all" aria-pressed="${!custom}">다 같이 ${S.people}명</button><button type="button" class="who-opt" data-who-set="some" aria-pressed="${custom}">일부만</button><span class="who-knob" aria-hidden="true"></span></div>
      ${custom ? `<span class="mini"><button type="button" data-wq="${c.pid}" data-d="-1" aria-label="인원 줄이기">−</button><span class="num">${n}명</span><button type="button" data-wq="${c.pid}" data-d="1" aria-label="인원 늘리기">+</button></span>` : ''}</div>`;
  }
  function cardHTML(c) {
    const p = PM[c.pid], l = lineCost(c), stay = p.category === 'stay';
    return `<div class="scard"><div class="h"><span class="pic" style="background:${CAT[p.category].c}">${CAT[p.category].k}</span><b>${esc(p.name)}</b><span class="amt num">${won(l.amt)}</span></div>
      <div class="f"><span class="num">${l.f}</span><button type="button" class="rm" data-rm="${p.id}">삭제</button></div>
      ${stay ? `<div class="f2"><span>객실</span><span class="mini"><button type="button" data-q="${p.id}" data-d="-1" aria-label="객실 줄이기">−</button><span class="num">${c.qty}실</span><button type="button" data-q="${p.id}" data-d="1" aria-label="객실 늘리기">+</button></span></div>` : whoHTML(c)}</div>`;
  }
  function renderStack() {
    const G = groups(), rids = Object.keys(G);
    if (S.basket !== 'all' && !G[S.basket]) S.basket = rids.length ? rids[rids.length - 1] : 'all';
    const show = S.basket === 'all' ? rids : [S.basket];
    const tabs = rids.length ? `<div class="btabs">${rids.length > 1 ? `<button type="button" class="btab" data-basket="all" aria-pressed="${S.basket === 'all'}">전체 <span class="c">${S.cart.length}</span></button>` : ''}${rids.map((rid) => `<button type="button" class="btab" data-basket="${rid}" aria-pressed="${S.basket === rid}"><span class="dot ${RM[rid].status}"></span>${RM[rid].name} <span class="c">${G[rid].length}</span></button>`).join('')}</div>` : '';
    $('stack').innerHTML = rids.length ? tabs + show.map((rid) => {
      const sub = G[rid].reduce((s, c) => s + lineCost(c).amt, 0), rf = refundOf(rid, sub), r = RM[rid];
      return `<div class="bgroup"><div class="bg-h"><b>${r.name} 바구니</b><span class="pill ${r.status}">${STL[r.status]}</span><span class="amt num">${won(sub)}</span></div>
        ${G[rid].slice().reverse().map(cardHTML).join('')}
        <div class="bg-f"><span>${r.name} 환급 예상 (${rf.ru.label}${rf.why ? ' · ' + rf.why : ''})</span><b class="num">− ${won(rf.v)}</b></div></div>`;
    }).join('') : `<div class="stack-empty">담은 장소가 가는 지역별 바구니로 쌓이고<br>예상 경비가 자동으로 계산돼요.</div>`;
    const items = S.cart.filter((c) => show.includes(PM[c.pid].region_id));
    const byCat = { food: 0, stay: 0, cafe: 0, spot: 0 }, byR = {}; let total = 0;
    items.forEach((c) => { const p = PM[c.pid], a = lineCost(c).amt; byCat[p.category] += a; byR[p.region_id] = (byR[p.region_id] || 0) + a; total += a; });
    $('bar').innerHTML = total ? Object.entries(byCat).filter((e) => e[1]).map(([k, v]) => `<i style="width:${v / total * 100}%;background:${CAT[k].c}"></i>`).join('') : '';
    let refund = 0, rg = '';
    Object.entries(byR).forEach(([rid, a]) => { const f = refundOf(rid, a); refund += f.v; rg += `${RM[rid].name} ${won(a)} → 환급 ${won(f.v)}${f.why ? ` (${f.why})` : ''}${RM[rid].status === 'closed' ? ' (현재 마감)' : ''}<br>`; });
    const only = Object.keys(byR).length === 1 ? refundOf(...Object.entries(byR)[0]) : null;
    const sumLabel = only ? only.ru.label : MODE[S.mode];
    const n = nights(), scope = S.basket === 'all' ? '전체 바구니' : (RM[S.basket] ? RM[S.basket].name + ' 바구니' : '');
    $('sum').innerHTML = `<div class="row"><span>${scope || '예상 경비'} · ${n}박 ${n + 1}일 ${S.people}명</span><b class="num">${won(total)}</b></div>
      <div class="row refund"><span>반값여행 환급 예상 (${sumLabel})</span><b class="num">− ${won(refund)}</b></div>
      <div class="row total"><span>실제 부담 예상</span><b class="num">${won(total - refund)}</b></div>
      ${S.cart.length ? `<button type="button" class="btn save-trip" data-save-trip>이 여행 저장하기</button>` : ''}
`;
    renderCompare();
  }

  /* ───────── 지역별 비교: 같은 금액을 쓰면 지역마다 환급·실부담이 얼마인지(지역 공고의 환급 규칙만 사용, 장소 가격 데이터는 쓰지 않음) ───────── */
  function estimate(rid, cost) {
    const rf = refundOf(rid, cost);
    return { rid, cost, refund: rf.v, pay: cost - rf.v, why: rf.why, ru: rf.ru };
  }
  function renderCompare() {
    const box = $('cmp');
    if (!S.cart.length) { box.innerHTML = ''; return; }
    const G = groups(), mine = Object.keys(G);
    const spend = S.cart.reduce((t, c) => t + lineCost(c).amt, 0);
    // 1) 담은 바구니끼리(실제 담은 장소 가격)
    const real = mine.length < 2 ? '' : (() => {
      const rows = mine.map((rid) => { const sub = G[rid].reduce((s, c) => s + lineCost(c).amt, 0), f = refundOf(rid, sub); return { rid, sub, v: f.v, why: f.why }; })
        .sort((a, b) => (a.sub - a.v) - (b.sub - b.v));
      return `<table class="ctable"><thead><tr><th>담은 바구니</th><th>경비</th><th>환급</th><th>실부담</th><th>환급률</th></tr></thead><tbody>${rows.map((x) => `<tr><td><span class="dot ${RM[x.rid].status}"></span>${RM[x.rid].name}</td><td class="num">${won(x.sub)}</td><td class="num acc">−${won(x.v)}</td><td class="num"><b>${won(x.sub - x.v)}</b></td><td class="num">${x.sub ? Math.round(x.v / x.sub * 100) : 0}%${x.why && x.v === 0 ? `<small>${esc(x.why)}</small>` : ''}</td></tr>`).join('')}</tbody></table>`;
    })();
    // 2) 같은 구성이면 지역마다 얼마?
    const all = R.filter((r) => S.cmpF === 'all' || r.status !== 'closed').map((r) => estimate(r.id, spend)).sort((a, b) => a.pay - b.pay || b.refund - a.refund);
    const show = (S.cmpMore ? all : all.slice(0, 5)).slice();
    mine.forEach((rid) => { if (!show.some((x) => x.rid === rid)) { const x = all.find((y) => y.rid === rid); if (x) show.push(x); } }); // 내 지역은 항상 보이게
    const max = Math.max(1, spend);
    const best = all[0], worst = all[all.length - 1];
    const cur = mine.length ? all.find((x) => x.rid === courseRid()) || null : null;
    const insight = !best ? '' : `<p class="cins"><b class="num">${won(spend)}</b>을 쓰면 <b>${RM[best.rid].name}</b>에서 환급 <b class="num">${won(best.refund)}</b>로 가장 많이 돌려받고${worst !== best && worst.pay > best.pay ? `, <b>${RM[worst.rid].name}</b>(환급 <span class="num">${won(worst.refund)}</span>)보다 <b class="num">${won(worst.pay - best.pay)}</b> 덜 내요.` : '.'}${cur && cur.rid !== best.rid && cur.pay > best.pay ? ` 지금 바구니 <b>${RM[cur.rid].name}</b>보다 <b class="num">${won(cur.pay - best.pay)}</b> 아낄 수 있어요.` : ''}</p>`;
    const head = `<button type="button" class="cmp-h" data-cmp-open aria-expanded="${!!S.cmpOpen}"><b>지역별 비교</b>${best && !S.cmpOpen ? `<small>${RM[best.rid].name} 환급 최대 ${won(best.refund)}</small>` : ''}<span class="chev">${S.cmpOpen ? '−' : '+'}</span></button>`;
    if (!S.cmpOpen) { box.innerHTML = head; return; }
    box.innerHTML = `${head}
      ${real}
      <div class="cmp-sub"><span>같은 금액을 다른 지역에서 쓰면?</span><div class="seg mini2" role="group" aria-label="비교할 지역"><button type="button" data-cmp-f="avail" aria-pressed="${S.cmpF !== 'all'}">신청 가능</button><button type="button" data-cmp-f="all" aria-pressed="${S.cmpF === 'all'}">전체</button></div></div>
      ${insight}
      <ol class="clist">${show.map((x) => { const r = RM[x.rid];
        return `<li${mine.includes(x.rid) ? ' class="mine"' : ''}><span class="rk num">${all.filter((y) => y.pay < x.pay).length + 1}</span>
          <button type="button" class="cn" data-cmp-r="${x.rid}"><span class="dot ${r.status}"></span>${r.name}${mine.includes(x.rid) ? '<span class="tag">담은 곳</span>' : ''}</button>
          <span class="cv"><b class="num">${won(x.pay)}</b><small class="num">환급 ${won(x.refund)}${x.ru.cap != null ? ` · 한도 ${won(x.ru.cap)}` : ''}</small></span>
          <span class="cbar" aria-hidden="true"><i class="p" style="width:${x.pay / max * 100}%"></i><i class="f" style="width:${x.refund / max * 100}%"></i></span>
          ${x.why && x.refund === 0 ? `<small class="cwhy">${esc(x.why)}</small>` : ''}</li>`; }).join('')}</ol>
      ${all.length > 5 ? `<button type="button" class="btn3 cmore" data-cmp-more>${S.cmpMore ? '접기' : `${all.length}곳 모두 보기`}</button>` : ''}
      <p class="fine">지금 경비를 그 지역에서 쓴다고 보고 환급 규칙으로만 계산했어요.</p>`;
  }

  /* ───────── 내 코스: 사용자가 정한 순서대로. '가까운 순'은 거리 계산(최근접 + 2-opt)으로 도와준다 ───────── */
  const km = (a, b) => { const R0 = 6371, t = Math.PI / 180, dLa = (b.lat - a.lat) * t, dLo = (b.lng - a.lng) * t;
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLo / 2) ** 2; return 2 * R0 * Math.asin(Math.sqrt(h)); };
  // 숙소(없으면 첫 장소)에서 출발 → 가장 가까운 곳부터(최근접) → 2-opt 로 꼬인 구간 풀기
  function shortestOrder(ids) {
    if (ids.length < 3) return ids.slice();
    const P = ids.map((id) => PM[id]);
    const s0 = Math.max(0, P.findIndex((p) => p.category === 'stay'));
    let order = [s0], left = new Set(P.map((_, i) => i)); left.delete(s0);
    while (left.size) { const last = P[order[order.length - 1]]; let best = null, bd = 1e9;
      left.forEach((i) => { const d = km(last, P[i]); if (d < bd) { bd = d; best = i; } }); order.push(best); left.delete(best); }
    const len = (o) => o.slice(1).reduce((s, i, k) => s + km(P[o[k]], P[i]), 0);
    for (let improved = true, guard = 0; improved && guard < 50; guard++) { improved = false;
      for (let i = 1; i < order.length - 1; i++) for (let j = i + 1; j < order.length; j++) {
        const o2 = order.slice(0, i).concat(order.slice(i, j + 1).reverse(), order.slice(j + 1));
        if (len(o2) + 1e-9 < len(order)) { order = o2; improved = true; } } }
    return order.map((i) => ids[i]);
  }
  // 코스는 한 지역 바구니 안에서만 (전체 보기일 땐 가장 많이 담은 지역)
  function courseRid() {
    const G = groups(); let rid = S.basket;
    if (rid === 'all' || !G[rid]) rid = Object.keys(G).sort((a, b) => G[b].length - G[a].length)[0];
    return rid || null;
  }
  // 사용자가 정한 순서(S.order[rid]) + 새로 담은 곳은 뒤에
  function courseIds(rid = courseRid()) {
    if (!rid) return [];
    const inB = groups()[rid].map((c) => c.pid), saved = (S.order[rid] || []).filter((id) => inB.includes(id));
    const ids = saved.concat(inB.filter((id) => !saved.includes(id)));
    S.order[rid] = ids; return ids;
  }
  const basketIds = () => courseIds();
  // 카카오맵 길찾기 링크(출발·경유·도착, 좌표 기반). API 호출이 아니라 링크라 사용량 제한이 없다.
  function kakaoRoute(ids) {
    const pts = ids.slice(0, 6).map((id) => { const p = PM[id]; return `${encodeURIComponent(p.name)},${p.lat},${p.lng}`; });
    return `https://map.kakao.com/link/by/car/${pts.join('/')}`;
  }
  function renderRoute() {
    const box = $('route'), rid = courseRid(), ids = courseIds(rid);
    if (ids.length < 2) { box.innerHTML = `<div class="route-h"><b>내 코스 <small>한 지역에 2곳 이상 담으면 만들어져요</small></b></div>`; return; }
    let tot = 0;
    const li = ids.map((id, i) => { const p = PM[id]; const d = i ? km(PM[ids[i - 1]], p) : 0; tot += d;
      return `<li data-stop="${id}"><span class="grip" data-grip aria-hidden="true" title="끌어서 순서 바꾸기"><svg viewBox="0 0 12 16"><circle cx="3.5" cy="3" r="1.4"/><circle cx="8.5" cy="3" r="1.4"/><circle cx="3.5" cy="8" r="1.4"/><circle cx="8.5" cy="8" r="1.4"/><circle cx="3.5" cy="13" r="1.4"/><circle cx="8.5" cy="13" r="1.4"/></svg></span><span class="k">${i + 1}</span><span class="nm2">${esc(p.name)}</span><span class="leg num">${i ? '+' + d.toFixed(1) + 'km' : '출발'}</span>
        <span class="mv"><button type="button" data-mv="${id}" data-d="-1" aria-label="${esc(p.name)} 앞으로"${i ? '' : ' disabled'}>↑</button><button type="button" data-mv="${id}" data-d="1" aria-label="${esc(p.name)} 뒤로"${i < ids.length - 1 ? '' : ' disabled'}>↓</button></span></li>`; }).join('');
    box.innerHTML = `<div class="route-h"><b>내 코스 · ${RM[rid].name} <small>직선 ${tot.toFixed(1)}km</small></b>
      <button type="button" class="btn2${S.route ? ' on' : ''}" data-route>${S.route ? '지도에서 끄기' : '지도에서 보기'}</button></div>
      <ol class="rsteps drag" id="rsteps">${li}</ol>
      <div class="rbtns"><button type="button" class="btn3" data-autosort>가까운 순으로 정렬</button><a class="btn3" href="${kakaoRoute(ids)}" target="_blank" rel="noopener">카카오맵 길찾기</a></div>
      <p class="rnote">⠿를 끌어서 순서를 바꿔요</p>`;
  }
  function drawRoute() {
    const g = $('g-route');
    if (!S.route) { g.innerHTML = ''; return; }
    g.innerHTML = `<polyline class="route-line" points="${S.route.map((id) => PM[id].x + ',' + PM[id].y).join(' ')}"/>`;
  }
  function toggleRoute() {
    if (S.route) { S.route = null; drawRoute(); renderRoute(); renderOverlay(); return; }
    const ids = basketIds(); if (ids.length < 2) return;
    S.route = ids.slice(); drawRoute(); renderRoute();
    const ps = S.route.map((id) => PM[id]), xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    const rids = new Set(ps.map((p) => p.region_id));
    openPanel(null);
    if (rids.size === 1) { S.view = 'region'; S.rid = ps[0].region_id; S.cat = 'all'; S.pid = null; renderAll(); }
    else { S.view = 'region'; S.rid = ps[0].region_id; renderAll(); }
    animateVB(fitBox([Math.min(...xs) - 4, Math.min(...ys) - 4, Math.max(...xs) + 4, Math.max(...ys) + 4], 0.25), 700, placeOverlay);
  }

  /* ───────── 마이: 로그인(시제품) · 알림 받는 지역 · 지난 여행 ───────── */
  const tripTitle = (cart) => [...new Set(cart.map((c) => RM[PM[c.pid].region_id].short))].join('·') + ' 여행';
  function saveTrip() {
    if (!needLogin('여행 저장')) return;
    const G = groups(), total = S.cart.reduce((s, c) => s + lineCost(c).amt, 0);
    const refund = Object.keys(G).reduce((s, rid) => s + refundOf(rid, G[rid].reduce((a, c) => a + lineCost(c).amt, 0)).v, 0);
    const trip = { id: uid(), title: tripTitle(S.cart), d1: $('d1').value, d2: $('d2').value, people: S.people, mode: S.mode,
      cart: S.cart.map((c) => ({ ...c })), order: JSON.parse(JSON.stringify(S.order)), total, pay: total - refund, savedAt: today() };
    DB.trips.unshift(trip); save();
    cloud(async (c) => { trip.id = await c.addTrip(trip); toast('지난 여행에 저장했어요 · 마이에서 다시 불러올 수 있어요'); });
    if (!CLOUD) toast('지난 여행에 저장했어요 · 마이에서 다시 불러올 수 있어요');
  }
  function loadTrip(id) {
    const t = DB.trips.find((x) => x.id === id); if (!t) return;
    S.cart = t.cart.filter((c) => PM[c.pid]).map((c) => ({ ...c })); S.order = JSON.parse(JSON.stringify(t.order || {}));
    $('d1').value = t.d1; $('d2').value = t.d2; S.people = t.people; $('pp').textContent = S.people + '명';
    S.mode = t.mode; document.querySelectorAll('#mode button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.m === S.mode));
    S.basket = 'all'; S.route = null; renderAll(); openPanel('trip'); toast(`'${t.title}'을 장바구니로 불러왔어요`);
  }
  function renderMy() {
    const box = $('my');
    if (!DB.user) {
      box.innerHTML = `<div class="login">
        <div class="login-mark"><svg viewBox="40 20 370 490" aria-hidden="true"><path d="M48 38H212V272H92V458H232V502H48V228H168V82H48Z" fill="#2f5d50"/><path d="M208 28H402V482H358V262H228V218H358V72H208Z" fill="#7fa597"/></svg></div>
        <h3>로그인하고 여행을 이어 가세요</h3>
        <p>신청 알림, 지난 여행 다시 보기, 커뮤니티 글쓰기는 로그인 후 쓸 수 있어요.</p>
        ${!CLOUD ? `<label class="fld"><span>닉네임</span><input id="loginName" maxlength="12" placeholder="예: 거창여행자" autocomplete="nickname"></label>
        <button type="button" class="btn" data-login>시작하기</button>
        <p class="fine">서버에 연결하지 못해 이 기기에만 저장하는 시제품 로그인으로 동작해요.</p>`
        : linkSent ? `<div class="sent"><b>메일을 보냈어요</b><span>${esc(linkSent)}</span>메일 속 <b>숫자 코드</b>를 아래에 넣거나, 이 컴퓨터에서 <b>로그인 링크</b>를 누르세요. 메일이 안 보이면 스팸함도 확인해 주세요.</div>
        <label class="fld"><span>메일 속 숫자 코드</span><input id="loginCode" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456"></label>
        <button type="button" class="btn" data-code-login>코드로 로그인</button>
        <button type="button" class="btn3" data-relink>다른 이메일로 받기</button>`
        : `${loginErr ? `<div class="lerr">${esc(loginErr)}</div>` : ''}
        <label class="fld"><span>이메일</span><input id="loginEmail" type="email" inputmode="email" placeholder="you@example.com" autocomplete="email"></label>
        <label class="fld"><span>비밀번호 (6자 이상)</span><input id="loginPw" type="password" autocomplete="current-password" placeholder="••••••"></label>
        <button type="button" class="btn" data-pw-login>로그인</button>
        <button type="button" class="btn3" data-pw-signup>처음이에요 · 가입하기</button>
        <button type="button" class="link small" data-email-login>비밀번호 없이 메일 링크로 로그인</button>`}</div>`;
      return;
    }
    if (!DB.user.name) { // 첫 로그인: 닉네임 정하기
      box.innerHTML = `<div class="login"><h3>닉네임을 정해 주세요</h3><p>커뮤니티에 코스를 올릴 때 보이는 이름이에요.</p>
        <label class="fld"><span>닉네임 (12자 이내)</span><input id="nickName" maxlength="12" value="${esc(DB.user.suggest || '')}" autocomplete="nickname"></label>
        <button type="button" class="btn" data-nick>시작하기</button></div>`;
      return;
    }
    const al = Object.keys(DB.alarms).filter((rid) => RM[rid]);
    box.innerHTML = `<div class="me"><span class="avatar">${esc(DB.user.name.slice(0, 1))}</span><div><b>${esc(DB.user.name)}</b><small>${esc(DB.user.since)} 가입${DB.user.email ? ' · ' + esc(DB.user.email) : ' · 이 기기 저장'}</small></div><button type="button" class="btn3" data-logout>로그아웃</button></div>
      <h4 class="sec">신청 알림 <small>${al.length}곳</small></h4>
      ${al.length ? `<div class="alist">${al.map((rid) => { const r = RM[rid]; return `<div class="arow"><span class="dot ${r.status}"></span><button type="button" class="link" data-r="${rid}">${r.sido} ${r.name}</button><span class="st ${r.status}">${STL[r.status]}</span><button type="button" class="x2" data-alarm="${rid}" aria-label="${r.name} 알림 끄기">끄기</button></div>`; }).join('')}</div>`
        : `<p class="empty">지역을 열고 🔔 신청 알림을 누르면 신청이 시작될 때 알려 드려요.</p>`}
      <h4 class="sec">지난 여행 <small>${DB.trips.length}개</small></h4>
      ${DB.trips.length ? DB.trips.map((t) => `<div class="tcard"><div class="th"><b>${esc(t.title)}</b><small>${esc(t.d1)} ~ ${esc(t.d2)} · ${t.people}명</small></div>
        <div class="tl">${t.cart.filter((c) => PM[c.pid]).map((c) => `<span class="tchip"><span class="dot" style="background:${CAT[PM[c.pid].category].c}"></span>${esc(PM[c.pid].name)}</span>`).join('')}</div>
        <div class="tf"><span>예상 부담 <b class="num">${won(t.pay)}</b> <small class="num">(경비 ${won(t.total)})</small></span><span><button type="button" class="btn3" data-load-trip="${t.id}">다시 보기</button><button type="button" class="x2" data-del-trip="${t.id}">삭제</button></span></div></div>`).join('')
        : `<p class="empty">장바구니에서 '이 여행 저장하기'를 누르면 여기에 쌓여요.</p>`}`;
  }

  /* ───────── Supabase 로그인·동기화 ───────── */
  let linkSent = '', loginErr = CLOUD ? CLOUD.linkError() : '';
  async function codeLogin(btn) {
    const code = ($('loginCode').value || '').replace(/\D/g, '');
    if (code.length < 6) { toast('메일 속 숫자 코드를 넣어 주세요'); return $('loginCode').focus(); }
    btn.disabled = true; btn.textContent = '확인 중…';
    try { await CLOUD.verifyCode(linkSent, code); }
    catch (e) { console.warn(e); btn.disabled = false; btn.textContent = '코드로 로그인';
      toast(/expired|invalid/i.test(e.message || '') ? '코드가 틀렸거나 만료됐어요. 최근 메일의 코드인지 확인해 주세요' : '로그인하지 못했어요. 잠시 후 다시 해 주세요'); }
  }
  async function pwAuth(btn, signup) {
    const email = ($('loginEmail').value || '').trim(), pw = $('loginPw').value || '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('이메일 주소를 확인해 주세요'); return $('loginEmail').focus(); }
    if (pw.length < 6) { toast('비밀번호는 6자 이상이에요'); return $('loginPw').focus(); }
    const label = btn.textContent; btn.disabled = true; btn.textContent = signup ? '가입하는 중…' : '로그인 중…';
    try {
      if (signup) {
        const r = await CLOUD.signUp(email, pw);
        if (r.needConfirm) { linkSent = email; loginErr = ''; renderMy(); toast('인증 메일을 보냈어요. 메일 속 숫자 코드를 넣으면 가입이 끝나요'); setTimeout(() => $('loginCode') && $('loginCode').focus(), 50); return; }
      } else await CLOUD.signIn(email, pw);
    } catch (e) {
      console.warn(e); btn.disabled = false; btn.textContent = label;
      const m = e.message || '';
      if (!signup && /not confirmed/i.test(m)) { // 가입 확인을 안 끝낸 계정: 확인 메일을 다시 보내고 코드 입력 화면으로
        try { await CLOUD.resendConfirm(email); linkSent = email; loginErr = ''; renderMy(); return toast('가입 확인이 아직 안 끝났어요. 확인 메일을 다시 보냈어요'); }
        catch (e2) { console.warn(e2); return toast('가입 확인 메일의 링크를 먼저 눌러 주세요 · ' + (e2.message || '')); }
      }
      toast(/Invalid login/i.test(m) ? '이메일 또는 비밀번호가 맞지 않아요. 처음이면 가입하기를 눌러 주세요'
        : /already registered|already been registered/i.test(m) ? '이미 가입한 이메일이에요. 로그인을 눌러 주세요'
        : /not confirmed/i.test(m) ? '가입 확인 메일의 링크를 먼저 눌러 주세요'
        : /not authorized/i.test(m) ? '이 주소로는 확인 메일을 보낼 수 없어요(서버 메일 설정 필요)'
        : /rate|seconds/i.test(m) ? '메일·시도 횟수 제한에 걸렸어요. 잠시 후 다시 해 주세요'
        : /password/i.test(m) ? '비밀번호가 너무 약해요. 더 길게 만들어 주세요' : '로그인하지 못했어요 · ' + (m || '네트워크 오류'));
    }
  }
  async function emailLogin(btn) {
    const email = ($('loginEmail').value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('이메일 주소를 확인해 주세요'); return $('loginEmail').focus(); }
    btn.disabled = true; btn.textContent = '보내는 중…';
    try { await CLOUD.sendLink(email); linkSent = email; loginErr = ''; renderMy(); setTimeout(() => $('loginCode') && $('loginCode').focus(), 50); }
    catch (e) { console.warn(e); btn.disabled = false; btn.textContent = '로그인 링크 받기';
      const m = e.message || '';
      toast(/rate|seconds/i.test(m) ? '메일을 너무 자주 요청했어요. 잠시 후 다시 해 주세요'
        : /not authorized/i.test(m) ? '이 주소로는 메일을 보낼 수 없어요(서버 메일 설정 필요)' : '메일을 보내지 못했어요 · ' + (m || '네트워크 오류')); }
  }
  async function saveNick(btn) {
    const n = ($('nickName').value || '').trim();
    if (!n) { toast('닉네임을 적어 주세요'); return $('nickName').focus(); }
    btn.disabled = true;
    if (await cloud((c) => c.setNickname(n).then(() => true), '닉네임을 저장하지 못했어요')) {
      DB.user.name = n; DB.user.since = today(); renderMy(); renderCommunity(); toast(`${n}님, 반가워요`);
      migrateLocal();
    } else btn.disabled = false;
  }
  // 서버 연결 전 이 기기에 저장해 둔 알림·지난 여행·코스 글을 첫 로그인 때 서버로 옮긴다
  async function migrateLocal() {
    let old; try { old = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { old = null; }
    if (!old || !CLOUD || !DB.user || !DB.user.name) return;
    const al = Object.entries(old.alarms || {}), tr = old.trips || [], po = (old.posts || []).filter((p) => p.ids && p.ids.length >= 2);
    if (!al.length && !tr.length && !po.length) { try { localStorage.removeItem(KEY); } catch (e) {} return; }
    try {
      for (const [rid, a] of al) if (RM[rid]) await CLOUD.setAlarm(rid, a.status);
      for (const t of tr.slice().reverse()) await CLOUD.addTrip(t);
      for (const p of po.slice().reverse()) await CLOUD.addPost(p);
      localStorage.removeItem(KEY);
      toast(`이 기기에 있던 알림 ${al.length} · 여행 ${tr.length} · 글 ${po.length}개를 계정으로 옮겼어요`);
      refreshCloud();
    } catch (e) { console.warn('옮기기 실패', e); }
  }
  // 서버에서 다시 읽어 화면을 맞춘다(로그인·로그아웃·오류 후)
  async function refreshCloud() {
    if (!CLOUD) return;
    try {
      const user = await CLOUD.session();
      if (user) {
        const [prof, mine] = await Promise.all([CLOUD.profile(), CLOUD.mine()]);
        DB.user = { id: user.id, email: user.email, name: prof ? prof.nickname : '', since: prof ? String(prof.created_at).slice(0, 10) : today(), suggest: (user.email || '').split('@')[0].slice(0, 12) };
        Object.assign(DB, mine);
      } else Object.assign(DB, { user: null, alarms: {}, trips: [], likes: {} });
      DB.posts = await CLOUD.posts(DB.likes);
    } catch (e) { console.warn('Supabase 읽기 실패', e); }
    renderLeft();
    if (DB.user && !DB.user.name && S.panel !== 'my') openPanel('my'); // 첫 로그인: 닉네임 정하기
    if (S.panel === 'my') renderMy();
    if (S.panel === 'community' && !writing) renderCommunity(); // 글 쓰는 중이면 입력을 지우지 않게
    if (DB.user && DB.user.name) { checkAlarms(); migrateLocal(); }
  }

  /* ───────── 커뮤니티: 사진을 곁들인 여행 글 + 지역 검색 ───────── */
  // 예시 글(실제 사용자 글 아님): 화면 설계용으로 수집 시트 장소를 이어 만든 코스
  const SEED = (() => {
    const mk = (id, rid, title, memo, cats) => {
      if (!RM[rid]) return null;
      const ids = cats.map(([c, i]) => (placesOf(rid).filter((p) => p.category === c)[i] || {}).id).filter(Boolean);
      return ids.length >= 2 ? { id, rid, title, author: '로컬로 예시', memo, ids, at: '2026-11-10', sample: true, likes: 0 } : null;
    };
    return [mk('s1', 'geochang', '거창 1박 2일 느긋한 코스', '첫날은 시내에서 점심 먹고 숙소로, 다음 날 카페 들렀다가 돌아오는 코스예요.', [['food', 0], ['stay', 0], ['cafe', 0], ['spot', 0]]),
      mk('s2', 'hamyang', '함양 당일치기 맛집 코스', '최소 소비 금액을 맞추기 좋게 식당 두 곳과 카페를 묶었어요.', [['food', 0], ['cafe', 0], ['food', 1]]),
      mk('s3', 'yeongwol', '영월 가족 여행 코스', '아이와 함께라 이동 거리를 짧게 잡았어요.', [['spot', 0], ['food', 0], ['stay', 0]])].filter(Boolean);
  })();
  let cFilter = 'all', writing = false, cq = '', draft = [], opened = {}, topRank = null, topAt = 0;
  const allPosts = () => DB.posts.concat(SEED);
  const PHOTO_MAX = 6;
  // 사진 주소는 우리 저장소(Supabase Storage) 것이나 이 기기에 저장한 이미지 데이터만 그린다
  const safeImg = (u) => (typeof u === 'string' && (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u) || (CLOUD && CLOUD.isImageUrl(u))) ? u : '');

  /* 지역 검색 + 많이 찾는 지역 TOP 10 */
  const SIDO_FULL = { 강원: '강원도 강원특별자치도', 충북: '충청북도', 충남: '충청남도', 경북: '경상북도', 경남: '경상남도', 전북: '전라북도 전북특별자치도', 전남: '전라남도' };
  const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const matchQ = (q) => (r) => [r.name, r.short, r.sido, SIDO_FULL[r.sido], r.id, r.sido + r.name].some((v) => norm(v).includes(norm(q)));
  const LS_SEARCH = 'localo.search';
  function loadTop(force) {
    if (!force && Date.now() - topAt < 30000) return;
    topAt = Date.now();
    if (!CLOUD) {
      try { const m = JSON.parse(localStorage.getItem(LS_SEARCH) || '{}'); topRank = Object.entries(m).map(([rid, count]) => ({ rid, count })).sort((a, b) => b.count - a.count); } catch (e) { topRank = []; }
      if (!cq) renderSearch(); return;
    }
    CLOUD.topSearches().then((r) => { topRank = r; if (!cq) renderSearch(); }).catch((e) => console.warn('검색 순위 읽기 실패(supabase/schema.sql 최신본 실행 필요)', e));
  }
  function bumpSearch(rid) {
    if (CLOUD) return CLOUD.bumpSearch(rid).then(() => loadTop(true)).catch(() => {});
    try { const m = JSON.parse(localStorage.getItem(LS_SEARCH) || '{}'); m[rid] = (m[rid] || 0) + 1; localStorage.setItem(LS_SEARCH, JSON.stringify(m)); } catch (e) { /* 저장 불가 */ }
    loadTop(true);
  }
  function topTen() {
    const srv = (topRank || []).filter((x) => RM[x.rid] && x.count > 0), seen = new Set(srv.map((x) => x.rid));
    const pc = {}; allPosts().forEach((p) => { pc[p.rid] = (pc[p.rid] || 0) + 1; });
    const rest = R.filter((r) => !seen.has(r.id)).sort((a, b) => (pc[b.id] || 0) - (pc[a.id] || 0) || ORDER[b.status] - ORDER[a.status]);
    return srv.concat(rest.map((r) => ({ rid: r.id, count: 0 }))).slice(0, 5);
  }
  function renderSearch() {
    const box = $('csr'); if (!box) return;
    const q = cq.trim();
    if (q) {
      const pc = {}; allPosts().forEach((p) => { pc[p.rid] = (pc[p.rid] || 0) + 1; });
      const hits = R.filter(matchQ(q));
      box.innerHTML = hits.length ? `<div class="shits">${hits.map((r) => `<button type="button" class="shit" data-cs="${r.id}"><span class="dot ${r.status}"></span><b>${r.name}</b><small>${r.sido} · 글 ${pc[r.id] || 0}개</small><span class="st ${r.status}">${STL[r.status]}</span></button>`).join('')}</div>`
        : `<p class="empty">'${esc(q)}'에 맞는 반값여행 지역이 없어요. 시·군 이름이나 도 이름(예: 경남)으로 찾아보세요.</p>`;
      return;
    }
    const top = topTen(), byCount = top.some((x) => x.count);
    box.innerHTML = `<div class="top10"><div class="t10h"><b>많이 찾는 지역 TOP 5</b></div>
      <ol class="t10">${top.map((x, i) => `<li><button type="button" data-cs="${x.rid}" aria-pressed="${cFilter === x.rid}"><span class="n num">${i + 1}</span><span class="nm">${RM[x.rid].name}</span><small>${RM[x.rid].sido}</small></button></li>`).join('')}</ol></div>`;
  }
  function pickRegion(rid) {
    if (rid !== 'all') bumpSearch(rid);
    cFilter = rid; cq = ''; renderCommunity();
  }

  /* 글: 사진을 곁들인 블로그 형식. 코스(장바구니 순서)는 선택해서 붙인다 */
  function postHTML(p) {
    const mine = !!p.mine, liked = !!DB.likes[p.id], r = RM[p.rid];
    const imgs = (p.images || []).map(safeImg).filter(Boolean), ids = (p.ids || []).filter((id) => PM[id]), open = !!opened[p.id];
    const long = (p.memo || '').length > 110 || (p.memo || '').split('\n').length > 3 || imgs.length > 1 || ids.length > 0;
    return `<article class="post blog">
      ${imgs[0] ? `<img class="cover" src="${esc(imgs[0])}" alt="${esc(p.title)} 대표 사진" loading="lazy">` : ''}
      <div class="pb">
        <div class="ph"><span class="pill ${r.status}">${r.name}</span>${p.sample ? '<span class="tag2">예시 글</span>' : ''}</div>
        <h3 class="pt">${esc(p.title)}</h3>
        <div class="pm">${esc(p.author)} · ${esc(p.at)}${imgs.length ? ` · 사진 ${imgs.length}` : ''}${ids.length ? ` · 코스 ${ids.length}곳` : ''}</div>
        ${p.memo ? `<p class="pmemo${open ? '' : ' clamp'}">${esc(p.memo)}</p>` : ''}
        ${open && imgs.length > 1 ? `<div class="gal">${imgs.slice(1).map((u, i) => `<img src="${esc(u)}" alt="${esc(p.title)} 사진 ${i + 2}" loading="lazy">`).join('')}</div>` : ''}
        ${open && ids.length ? `<div class="pcourse"><b>코스</b><ol class="rsteps small">${ids.map((id, i) => `<li><span class="k">${i + 1}</span><span class="nm2">${esc(PM[id].name)}</span></li>`).join('')}</ol></div>` : ''}
        ${long ? `<button type="button" class="more" data-open-post="${p.id}" aria-expanded="${open}">${open ? '접기' : '더 보기'}</button>` : ''}
        <div class="pf"><button type="button" class="like${liked ? ' on' : ''}" data-like="${p.id}" aria-pressed="${liked}">♥ <span class="num">${(p.likes || 0) + (liked ? 1 : 0)}</span></button><span>${ids.length ? `<button type="button" class="btn3" data-take="${p.id}">코스 담기</button>` : ''}${mine ? `<button type="button" class="x2" data-del-post="${p.id}">삭제</button>` : ''}</span></div>
      </div></article>`;
  }
  function renderDraft() {
    const box = $('pPrev'); if (!box) return;
    box.innerHTML = draft.map((d, i) => `<span class="thumb"><img src="${d.url}" alt="고른 사진 ${i + 1}"><button type="button" data-draft-rm="${i}" aria-label="사진 ${i + 1} 빼기">×</button></span>`).join('')
      + (draft.length < PHOTO_MAX ? `<label class="addph"><input type="file" id="pFile" accept="image/jpeg,image/png,image/webp,image/*" multiple hidden><span>＋</span><small>${draft.length}/${PHOTO_MAX}</small></label>` : '');
  }
  function clearDraft() { draft.forEach((d) => URL.revokeObjectURL(d.url)); draft = []; }
  // 사진은 올리기 전에 긴 변 1280px JPEG로 줄인다(용량·속도)
  async function shrink(file, max = 1280) {
    const src = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.82));
    } finally { URL.revokeObjectURL(src); }
  }
  async function addPhotos(files) {
    const list = [...files].slice(0, PHOTO_MAX - draft.length);
    if (files.length > list.length) toast(`사진은 ${PHOTO_MAX}장까지 넣을 수 있어요`);
    for (const f of list) {
      try { const blob = await shrink(f); if (blob) draft.push({ blob, url: URL.createObjectURL(blob) }); }
      catch (e) { console.warn(e); toast('이 사진은 열 수 없어요(JPG·PNG로 바꿔 주세요)'); }
    }
    renderDraft();
  }
  const toDataURL = (blob) => new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });

  function renderCommunity() {
    const box = $('community'), posts = allPosts();
    const list = posts.filter((p) => RM[p.rid] && (cFilter === 'all' || p.rid === cFilter));
    const crid = courseRid(), cids = crid ? courseIds(crid) : [];
    const def = cFilter !== 'all' ? cFilter : crid || R[0].id;
    const form = !writing ? '' : `<div class="wform">
      <h4 class="sec">여행 글 쓰기</h4>
      <label class="fld"><span>지역</span><select id="pRid">${SIDO_ORDER.map((sd) => `<optgroup label="${sd}">${R.filter((r) => r.sido === sd).map((r) => `<option value="${r.id}"${r.id === def ? ' selected' : ''}>${r.name}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <label class="fld"><span>제목</span><input id="pTitle" maxlength="40" placeholder="예: ${RM[def].short} 1박 2일 먹방 여행"></label>
      <label class="fld"><span>본문</span><textarea id="pMemo" rows="8" maxlength="3000" placeholder="다녀온 이야기, 이동 순서, 최소 소비 금액 맞추는 팁 등을 자유롭게 적어 주세요"></textarea></label>
      <div class="fld"><span>사진 (최대 ${PHOTO_MAX}장 · 첫 장이 대표 사진)</span><div class="pprev" id="pPrev"></div></div>
      ${cids.length >= 2 ? `<label class="chk"><input type="checkbox" id="pCourse" checked><span>장바구니의 <b>${RM[crid].name}</b> 코스 ${cids.length}곳도 함께 올리기</span></label>
        <ol class="rsteps small">${cids.map((id, i) => `<li><span class="k">${i + 1}</span><span class="nm2">${esc(PM[id].name)}</span></li>`).join('')}</ol>` : ''}
      <div class="rbtns"><button type="button" class="btn" data-post>올리기</button><button type="button" class="btn3" data-write>취소</button></div></div>`;
    box.innerHTML = `<label class="sbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg><input id="cq" type="search" placeholder="지역 검색 · 예: 거창, 경남" value="${esc(cq)}" autocomplete="off" enterkeyhint="search" aria-label="지역 검색"></label>
      <div id="csr"></div>
      <div class="c-head">${cFilter !== 'all' ? `<p class="cfil"><span class="dot ${RM[cFilter].status}"></span><b>${RM[cFilter].name}</b> 글 ${list.length}개 <button type="button" class="x2" data-cs="all">전체 보기</button></p>` : '<p></p>'}${writing ? '' : '<button type="button" class="btn" data-write>글쓰기</button>'}</div>
      ${form}
      <div class="posts">${list.map(postHTML).join('') || '<p class="empty">아직 이 지역 글이 없어요. 첫 글을 남겨 보세요.</p>'}</div>
      ${CLOUD ? '' : '<p class="fine">서버에 연결하지 못해 글이 이 기기에만 저장돼요.</p>'}`;
    renderSearch(); renderDraft();
  }
  async function postArticle(btn) {
    const rid = $('pRid').value, title = $('pTitle').value.trim(), memo = $('pMemo').value.trim();
    if (!title) { toast('제목을 적어 주세요'); return $('pTitle').focus(); }
    if (!memo && !draft.length) { toast('본문이나 사진을 넣어 주세요'); return $('pMemo').focus(); }
    const crid = courseRid(), withCourse = !!($('pCourse') && $('pCourse').checked);
    if (withCourse && crid !== rid) { toast(`코스는 ${RM[crid].name} 지역이에요. 지역을 맞추거나 코스 첨부를 해제해 주세요`); return $('pRid').focus(); }
    const post = { id: uid(), rid, title, memo, ids: withCourse ? courseIds(crid).slice() : [], images: [], author: DB.user.name, at: today(), likes: 0, mine: true };
    const label = btn.textContent; btn.disabled = true;
    if (CLOUD) {
      try {
        for (let i = 0; i < draft.length; i++) { btn.textContent = `사진 올리는 중 ${i + 1}/${draft.length}…`; post.images.push(await CLOUD.uploadImage(draft[i].blob)); }
        btn.textContent = '올리는 중…'; post.id = await CLOUD.addPost(post);
      } catch (e) {
        console.warn(e); btn.disabled = false; btn.textContent = label;
        if (post.images.length) CLOUD.removeImages(post.images).catch(() => {});
        const m = (e && e.message) || '';
        return toast(/bucket|images|column|schema|check constraint/i.test(m) ? '사진·글 저장소가 아직 준비되지 않았어요 · supabase/schema.sql 최신본을 실행해 주세요' : '글을 올리지 못했어요. 잠시 후 다시 해 주세요');
      }
    } else post.images = await Promise.all(draft.map((d) => toDataURL(d.blob)));
    DB.posts.unshift(post); save(); clearDraft(); writing = false; cFilter = rid; renderCommunity(); toast('글을 올렸어요');
  }
  function takeCourse(id) {
    const p = allPosts().find((x) => x.id === id); if (!p) return;
    p.ids.filter((pid) => PM[pid] && !S.cart.some((c) => c.pid === pid)).forEach((pid) => S.cart.push({ pid, qty: defaultQty(PM[pid]) }));
    S.order[p.rid] = p.ids.slice(); S.basket = p.rid; S.route = null; renderAll();
    toast(`${RM[p.rid].name} 바구니에 코스를 담았어요`); openPanel('trip');
  }

  /* ───────── 상태 전환 ───────── */
  function paintTargets() {
    if (S.view === 'all') [...R].sort((a, b) => ORDER[a.status] - ORDER[b.status]).forEach((r) => $('g-targets').appendChild(r.el));
    R.forEach((r) => {
      r.el.classList.toggle('sel', S.view === 'region' && r.id === S.rid);
      if (S.view === 'region' && r.id === S.rid) $('g-targets').appendChild(r.el); // 이웃이 경계선을 덮지 않게 맨 위로
      r.el.classList.toggle('dimmed', S.view === 'all' && S.filter !== 'all' && r.status !== S.filter);
    });
    deco.style.opacity = S.view === 'all' ? 1 : 0;
  }
  function renderAll() { document.body.classList.toggle('zoomed', S.view === 'region'); renderTop(); renderLeft(); renderBadge(); renderStack(); renderRoute(); drawRoute(); paintTargets(); renderOverlay(); }
  function openRegion(id) {
    S.view = 'region'; S.rid = id; S.cat = 'all'; S.pid = null;
    if (mobile()) setSheet('peek');
    renderAll(); animateVB(fitBox(RM[id].bbox), 700, placeOverlay);
    $('left').scrollTop = 0;
    record();
  }
  // 전국 지도(메인)로 돌아올 때마다 ㄹㅋ 마크가 한반도로 바뀌는 인트로를 다시 보여 준다
  function goHome() { cancelAnimationFrame(anim); S.view = 'all'; S.rid = null; S.pid = null; vb = VB0.slice(); svg.setAttribute('viewBox', vb.join(' ')); renderAll(); playIntro(); record(); }

  /* ───────── 화면 기록: 로고·뒤로가기 제스처로 직전 화면 복원 ───────── */
  let restoring = false;
  const snap = () => ({ view: S.view, rid: S.rid, cat: S.cat, pid: S.pid, panel: S.panel });
  const same = (a, b) => !!a && ['view', 'rid', 'cat', 'pid', 'panel'].every((k) => a[k] === b[k]);
  function record() {
    if (restoring) return;
    const s = snap(), h = history.state;
    if (same(h, s)) return;
    history.pushState({ ...s, i: ((h && h.i) || 0) + 1 }, '');
  }
  function restore(s) {
    restoring = true;
    openPanel(s.panel || null);
    if (s.view === 'all') {
      if (S.view !== 'all') goHome(); else { S.pid = null; renderLeft(); renderOverlay(); }
    } else {
      const moved = S.view !== 'region' || S.rid !== s.rid;
      S.view = 'region'; S.rid = s.rid; S.cat = s.cat; S.pid = s.pid;
      renderAll();
      if (moved) { animateVB(fitBox(RM[s.rid].bbox), 700, placeOverlay); $('left').scrollTop = 0; }
    }
    restoring = false;
  }
  function goBack() {
    if (history.state && history.state.i > 0) return history.back();
    openPanel(null);
    if (S.view !== 'all') goHome(); else if (S.pid) { S.pid = null; renderLeft(); renderOverlay(); }
  }
  addEventListener('popstate', (e) => { if (e.state) restore(e.state); });
  // 로고: 어디에 있든 첫 화면(전국 지도 · 지도 탭)으로
  function goMain() {
    restoring = true; openPanel(null); restoring = false;
    if (mobile()) setSheet('peek');
    if (S.view !== 'all') return goHome();
    S.pid = null; renderLeft(); renderOverlay(); playIntro(); record();
  }
  // 왼쪽 가장자리에서 오른쪽으로 밀면 이전 화면(탭)으로.
  // 브라우저 자체 뒤로가기 제스처가 없는 곳(홈 화면 앱, 폰 목업 iframe)에서만 직접 처리한다 — 일반 브라우저는 기록(popstate)으로 같은 동작을 한다.
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone || window.top !== window) {
    const edge = document.createElement('div'); edge.className = 'edge-back'; edge.setAttribute('aria-hidden', 'true');
    edge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
    document.body.appendChild(edge);
    // 손가락은 touch 이벤트로(스크롤이 시작돼도 끊기지 않게), 마우스(데스크톱의 폰 목업)는 pointer 이벤트로 받는다
    let sw = null;
    const start = (x, y) => { sw = x < 24 ? { x, y, t: Date.now() } : null; if (sw) edge.style.transition = 'none'; };
    const move = (x, y) => {
      if (!sw) return;
      const k = Math.min(1, Math.max(0, x - sw.x) / 90);
      edge.style.opacity = k; edge.style.transform = `translate(${-40 + 52 * k}px, ${y}px) translateY(-50%) scale(${0.6 + 0.4 * k})`;
      edge.classList.toggle('ready', k >= 1);
    };
    const end = (x, y, ok) => {
      if (!sw) return;
      const dx = x - sw.x, dy = Math.abs(y - sw.y);
      if (ok && dx > 70 && dy < dx * 0.7 && Date.now() - sw.t < 900) goBack();
      edge.style.transition = ''; edge.style.opacity = 0; edge.classList.remove('ready'); sw = null;
    };
    const tp = (e) => e.changedTouches[0];
    addEventListener('touchstart', (e) => { if (e.touches.length === 1) start(tp(e).clientX, tp(e).clientY); else sw = null; }, { passive: true });
    addEventListener('touchmove', (e) => move(tp(e).clientX, tp(e).clientY), { passive: true });
    addEventListener('touchend', (e) => end(tp(e).clientX, tp(e).clientY, true), { passive: true });
    addEventListener('touchcancel', (e) => end(tp(e).clientX, tp(e).clientY, false), { passive: true });
    const mouse = (f) => (e) => { if (e.pointerType === 'mouse') f(e); };
    addEventListener('pointerdown', mouse((e) => start(e.clientX, e.clientY)));
    addEventListener('pointermove', mouse((e) => move(e.clientX, e.clientY)));
    addEventListener('pointerup', mouse((e) => end(e.clientX, e.clientY, true)));
  }
  function toggleCart(pid) {
    const i = S.cart.findIndex((c) => c.pid === pid);
    if (i >= 0) S.cart.splice(i, 1);
    else { S.cart.push({ pid, qty: defaultQty(PM[pid]) }); S.basket = PM[pid].region_id; toast(`${RM[PM[pid].region_id].name} 바구니에 담았어요`); }
    S.route = null; drawRoute(); renderBadge(); renderStack(); renderRoute(); renderOverlay();
  }

  /* ───────── 휴대폰 시트·탭 ───────── */
  const sheet = $('sheet');
  function setSheet(state) {
    document.body.dataset.sheet = state;
    const H = $('mapwrap').parentElement.clientHeight;
    sheet.style.setProperty('--sheet-h', state === 'peek' ? '' : state === 'half' ? Math.round(H * 0.56) + 'px' : Math.round(H * 0.94) + 'px');
  }
  let drag = null;
  $('handle').addEventListener('pointerdown', (e) => { drag = { y: e.clientY, h: sheet.offsetHeight, moved: false }; sheet.classList.add('dragging'); $('handle').setPointerCapture(e.pointerId); });
  $('handle').addEventListener('pointermove', (e) => { if (!drag) return; const dy = drag.y - e.clientY; if (Math.abs(dy) > 4) drag.moved = true; sheet.style.setProperty('--sheet-h', Math.max(120, drag.h + dy) + 'px'); });
  $('handle').addEventListener('pointerup', () => {
    if (!drag) return; sheet.classList.remove('dragging');
    const H = sheet.parentElement.clientHeight, h = sheet.offsetHeight;
    if (!drag.moved) setSheet({ peek: 'half', half: 'full', full: 'peek' }[document.body.dataset.sheet]);
    else setSheet(h < H * 0.38 ? 'peek' : h < H * 0.78 ? 'half' : 'full');
    drag = null;
  });
  // 화면 위에 여는 패널: trip(장바구니) · my(마이) · community(커뮤니티). null = 지도
  function openPanel(name) {
    S.panel = name;
    ['trip', 'my', 'community'].forEach((k) => document.body.classList.toggle(k + '-open', name === k));
    if (name === 'my') renderMy();
    if (name === 'community') { renderCommunity(); loadTop(); }
    const cur = name === 'trip' || !name ? 'map' : name;
    document.querySelectorAll('.tabbar [data-tab], .nav [data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === cur ? 'page' : 'false'));
    if (name === 'trip' && !mobile()) $('trip').querySelector('.p-scroll').scrollTo({ top: 0, behavior: 'smooth' });
    record();
  }
  const openTrip = (on) => openPanel(on ? 'trip' : null);
  function setWho(pid, some) {
    const c = S.cart.find((x) => x.pid === pid); if (!c) return;
    if (some && S.people < 2) { toast('여행 인원이 2명 이상일 때 일부만 갈 수 있어요'); return; }
    c.who = some ? Math.max(1, S.people - 1) : null; renderStack();
  }
  // 내 코스 끌어서 놓기: 손잡이(⠿)를 잡고 위아래로 끌면 자리가 바뀐다. 손가락·마우스 모두(pointer 이벤트)
  let dd = null;
  document.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('[data-grip]'); if (!g) return;
    const li = g.closest('li'), ol = li.parentElement;
    e.preventDefault();
    dd = { li, ol, y0: e.clientY, top0: li.offsetTop, id: e.pointerId };
    li.classList.add('dragging'); ol.classList.add('sorting');
    try { g.setPointerCapture(e.pointerId); } catch (_) { /* 일부 브라우저 */ }
  });
  document.addEventListener('pointermove', (e) => {
    if (!dd || e.pointerId !== dd.id) return;
    const { li, ol } = dd;
    // 손가락 위치에 맞는 자리로 옮기기(다른 항목의 가운데를 넘으면 자리 교체)
    const sibs = [...ol.children].filter((x) => x !== li);
    const after = sibs.find((x) => { const r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (after ? li.nextElementSibling !== after : ol.lastElementChild !== li) ol.insertBefore(li, after || null);
    li.style.transform = `translateY(${e.clientY - dd.y0 - (li.offsetTop - dd.top0)}px)`;
    [...ol.children].forEach((x, i) => { const k = x.querySelector('.k'); if (k) k.textContent = i + 1; });
  });
  const endDrag = (e) => {
    if (!dd || (e && e.pointerId !== dd.id)) return;
    const { li, ol } = dd; dd = null;
    li.classList.remove('dragging'); ol.classList.remove('sorting'); li.style.transform = '';
    const rid = courseRid(), ids = [...ol.children].map((x) => x.dataset.stop).filter(Boolean);
    if (!rid || ids.join() === courseIds(rid).join()) return renderRoute();
    S.order[rid] = ids; if (S.route) S.route = ids.slice();
    drawRoute(); renderRoute(); renderOverlay();
  };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  function moveStop(pid, dir) {
    const rid = PM[pid].region_id, ids = courseIds(rid), i = ids.indexOf(pid), j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]]; S.order[rid] = ids;
    if (S.route) S.route = ids.slice();
    drawRoute(); renderRoute(); renderOverlay();
  }
  // '다 같이 ↔ 일부만' 스위치를 손가락·마우스로 밀기: 왼쪽으로 밀면 다 같이, 오른쪽으로 밀면 일부만
  let wd = null;
  document.addEventListener('pointerdown', (e) => { const tr = e.target.closest('.who-track'); if (tr) wd = { x: e.clientX, pid: tr.closest('[data-who]').dataset.who, moved: false }; });
  document.addEventListener('pointermove', (e) => { if (wd && Math.abs(e.clientX - wd.x) > 12) wd.moved = true; });
  document.addEventListener('pointerup', (e) => {
    if (!wd) return; const dx = e.clientX - wd.x, pid = wd.pid, moved = wd.moved; wd = null;
    if (moved && Math.abs(dx) > 24) { suppressClick = true; setWho(pid, dx > 0); }
  });
  let suppressClick = false;
  document.addEventListener('click', (e) => { if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
  document.querySelector('.page-dim').addEventListener('click', () => openPanel(null));
  let toastT;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1600); }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    if (d.r && !t.closest('svg')) { if (S.panel && S.panel !== 'trip') { restoring = true; openPanel(null); restoring = false; } return openRegion(d.r); }
    if (t.hasAttribute('data-logo')) return goMain();
    if (t.hasAttribute('data-home')) return goHome();
    if (d.f) { S.filter = d.f; renderTop(); renderLeft(); paintTargets(); renderOverlay(); return; }
    if (d.alarm) return toggleAlarm(d.alarm);
    if (d.cat) { S.cat = d.cat; S.pid = null; renderTop(); renderLeft(); renderOverlay(); return record(); }
    if (d.p) { S.pid = d.p; if (mobile()) setSheet('peek'); renderLeft(); renderOverlay(); return record(); }
    if (t.hasAttribute('data-close')) { S.pid = null; renderLeft(); renderOverlay(); return record(); }
    if (d.add) return toggleCart(d.add);
    if (d.rm) return toggleCart(d.rm);
    if (d.q) { const c = S.cart.find((c) => c.pid === d.q); c.qty = Math.max(1, c.qty + +d.d); renderStack(); return; }
    if (d.whoSet) return setWho(t.closest('[data-who]').dataset.who, d.whoSet === 'some');
    if (d.wq) { const c = S.cart.find((c) => c.pid === d.wq); c.who = Math.max(1, Math.min(S.people - 1, pplOf(c) + +d.d)); renderStack(); return; }
    if (d.mv) return moveStop(d.mv, +d.d);
    if (t.hasAttribute('data-autosort')) { const rid = courseRid(); S.order[rid] = shortestOrder(courseIds(rid)); if (S.route) S.route = courseIds(rid); drawRoute(); renderRoute(); renderOverlay(); return toast('가까운 순으로 정렬했어요'); }
    if (t.hasAttribute('data-save-trip')) return saveTrip();
    if (d.loadTrip) return loadTrip(d.loadTrip);
    if (d.delTrip) { const id = d.delTrip; DB.trips = DB.trips.filter((x) => x.id !== id); save(); cloud((c) => c.delTrip(id)); return renderMy(); }
    if (t.hasAttribute('data-email-login')) return emailLogin(t);
    if (t.hasAttribute('data-pw-login')) return pwAuth(t, false);
    if (t.hasAttribute('data-pw-signup')) return pwAuth(t, true);
    if (t.hasAttribute('data-relink')) { linkSent = ''; return renderMy(); }
    if (t.hasAttribute('data-code-login')) return codeLogin(t);
    if (t.hasAttribute('data-nick')) return saveNick(t);
    if (t.hasAttribute('data-login')) { const n = ($('loginName').value || '').trim(); if (!n) { toast('닉네임을 적어 주세요'); return $('loginName').focus(); } DB.user = { name: n, since: today() }; save(); renderMy(); renderLeft(); return toast(`${n}님, 반가워요`); }
    if (t.hasAttribute('data-logout')) { if (CLOUD) { CLOUD.signOut(); return; } DB.user = null; save(); renderMy(); renderLeft(); return toast('로그아웃했어요'); }
    if (t.hasAttribute('data-write')) { if (!writing && !needLogin('글쓰기')) return; if (!writing && !DB.user.name) { openPanel('my'); return toast('닉네임을 먼저 정해 주세요'); } writing = !writing; if (!writing) clearDraft(); return renderCommunity(); }
    if (t.hasAttribute('data-post')) return postArticle(t);
    if (d.cs) return pickRegion(d.cs);
    if (d.openPost) { opened[d.openPost] = !opened[d.openPost]; return renderCommunity(); }
    if (d.draftRm) { const [x] = draft.splice(+d.draftRm, 1); if (x) URL.revokeObjectURL(x.url); return renderDraft(); }
    if (d.like) {
      const id = d.like, post = allPosts().find((x) => x.id === id);
      if (CLOUD && post && !post.sample) { // 서버 글: 로그인 필요
        if (!needLogin('좋아요')) return;
        if (DB.likes[id]) { delete DB.likes[id]; cloud((c) => c.unlike(id)); } else { DB.likes[id] = 1; cloud((c) => c.like(id)); }
      } else if (DB.likes[id]) delete DB.likes[id]; else DB.likes[id] = 1; // 예시 글·시제품: 화면에서만
      save(); return renderCommunity();
    }
    if (d.take) return takeCourse(d.take);
    if (d.delPost) { const id = d.delPost, gone = DB.posts.find((x) => x.id === id); DB.posts = DB.posts.filter((x) => x.id !== id); save(); cloud((c) => c.delPost(id, (gone && gone.images) || [])); return renderCommunity(); }
    if (d.m) { S.mode = d.m; document.querySelectorAll('#mode button').forEach((b) => b.setAttribute('aria-pressed', b === t)); renderStack(); return; }
    if (t.id === 'pm' || t.id === 'pl') return setPeople(S.people + (t.id === 'pl' ? 1 : -1));
    if (t.hasAttribute('data-cmp-open')) { S.cmpOpen = !S.cmpOpen; return renderCompare(); }
    if (d.cmpF) { S.cmpF = d.cmpF; return renderCompare(); }
    if (t.hasAttribute('data-cmp-more')) { S.cmpMore = !S.cmpMore; return renderCompare(); }
    if (d.cmpR) { if (mobile()) { restoring = true; openPanel(null); restoring = false; } return openRegion(d.cmpR); }
    if (d.basket) { S.basket = d.basket; S.route = null; drawRoute(); renderStack(); renderRoute(); renderOverlay(); return; }
    if (t.hasAttribute('data-route')) return toggleRoute();
    if (d.tab === 'map' && t.closest('.tabbar')) return goMain();
    if (d.tab) { const was = S.panel; openPanel(d.tab === 'map' ? null : d.tab); if (d.tab === 'map' && was && was !== 'trip' && S.view === 'all') playIntro(); return; }
    if (d.soon) return toast(`${d.soon}은 다음 단계에서 열려요`);
  });
  // 커뮤니티 검색창: 글자를 칠 때마다 결과만 다시 그린다(입력창은 그대로 두어 포커스 유지)
  document.addEventListener('input', (e) => { if (e.target.id === 'cq') { cq = e.target.value; renderSearch(); } });
  document.addEventListener('keydown', (e) => { if (e.target.id === 'cq' && e.key === 'Enter') { const h = R.filter(matchQ(cq.trim())); if (cq.trim() && h.length) pickRegion((h.find((r) => norm(r.name) === norm(cq) || norm(r.short) === norm(cq)) || h[0]).id); } });
  document.addEventListener('change', (e) => { if (e.target.id === 'pFile' && e.target.files.length) addPhotos(e.target.files); });
  ['d1', 'd2'].forEach((id) => $(id).addEventListener('change', () => { renderStack(); renderRoute(); }));
  new ResizeObserver(() => { if (S.view === 'all') { vb = VB0.slice(); svg.setAttribute('viewBox', vb.join(' ')); layoutPins(); } else setVB(fitBox(RM[S.rid].bbox)); placeOverlay(); }).observe(wrap);

  /* ───────── 인트로: 가운데 둥근 ㄹㅋ 마크 → 한반도 윤곽으로 부풀어 변형 ───────── */
  const morph = $('morph');
  const layers = [$('g-shadow'), $('g-prov'), $('g-munis'), $('g-targets'), $('g-deco')];
  // 모서리를 둥글게 깎은 다각형(각 꼭짓점을 2차 곡선으로 이어 붓으로 쓴 듯 부드럽게)
  function roundPoly(pts, r, seg = 7) {
    const out = [], n = pts.length;
    for (let i = 0; i < n; i++) {
      const P = pts[i], A = pts[(i + n - 1) % n], B = pts[(i + 1) % n];
      const la = Math.hypot(A[0] - P[0], A[1] - P[1]), lb = Math.hypot(B[0] - P[0], B[1] - P[1]);
      const rr = Math.min(r, la / 2, lb / 2);
      const p0 = [P[0] + (A[0] - P[0]) / la * rr, P[1] + (A[1] - P[1]) / la * rr];
      const p2 = [P[0] + (B[0] - P[0]) / lb * rr, P[1] + (B[1] - P[1]) / lb * rr];
      for (let j = 0; j <= seg; j++) {
        const t = j / seg, u = 1 - t;
        out.push([u * u * p0[0] + 2 * u * t * P[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * P[1] + t * t * p2[1]]);
      }
    }
    return out;
  }
  function glyphs() {
    // 본토 한가운데에 작고 둥근 ㄹㅋ 마크(본토 높이의 38%)를 놓는다. 획 끝과 꺾임은 획 굵기의 절반으로 둥글려 알약처럼.
    const tmp = el('path', { d: GEO.mainland }); svg.appendChild(tmp); const b = tmp.getBBox(); tmp.remove();
    const h = b.height * 0.38, w = h * 354 / 474, x0 = b.x + b.width / 2 - w / 2, y0 = b.y + b.height * 0.47 - h / 2;
    const mapPt = (x, y) => [x0 + (x - 48) / 354 * w, y0 + (y - 28) / 474 * h];
    const poly = (pts) => 'M' + roundPoly(pts, 31, 9).map(([x, y]) => mapPt(x, y).map((v) => v.toFixed(2)).join(' ')).join('L') + 'Z';
    return [
      poly([[48, 28], [236, 28], [236, 290], [110, 290], [110, 440], [240, 440], [240, 502], [48, 502], [48, 228], [174, 228], [174, 90], [48, 90]]),
      poly([[214, 28], [402, 28], [402, 502], [340, 502], [340, 282], [228, 282], [228, 220], [340, 220], [340, 90], [214, 90]]),
    ];
  }
  let introRaf = null;
  function playIntro() {
    if (S.view !== 'all') { S.view = 'all'; S.rid = null; S.pid = null; vb = VB0.slice(); svg.setAttribute('viewBox', vb.join(' ')); renderAll(); }
    cancelAnimationFrame(introRaf);
    wrap.classList.remove('intro'); void wrap.offsetWidth; wrap.classList.add('intro');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !window.flubber) { morph.setAttribute('d', ''); layers.forEach((l) => (l.style.opacity = 1)); wrap.classList.remove('intro'); return; }
    const [gR, gK] = glyphs();
    const interp = flubber.combine([gR, gK], GEO.mainland, { single: true, maxSegmentLength: 5 });
    const ACC = [47, 93, 80], LAND = [255, 255, 255];
    const mix = (k) => 'rgb(' + ACC.map((v, i) => Math.round(v + (LAND[i] - v) * k)).join(',') + ')';
    // 부드러운 움직임: 살짝 지나쳤다 돌아오는 도착(back-out), 사인 곡선 변형
    const backOut = (k) => { const c = 1.35; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
    const sine = (k) => -(Math.cos(Math.PI * k) - 1) / 2;
    layers.forEach((l) => { l.style.transition = 'none'; l.style.opacity = 0; });
    const t0 = performance.now(), r0 = interp(0);
    const tmp = el('path', { d: r0 }); svg.appendChild(tmp); const gb = tmp.getBBox(); tmp.remove();
    const gcx = gb.x + gb.width / 2, gcy = gb.y + gb.height / 2;
    const scaleAt = (k) => `translate(${gcx} ${gcy}) scale(${k}) translate(${-gcx} ${-gcy})`;
    const step = (t) => {
      const e = (t - t0) / 1000;
      if (e < 0.9) { // 1) 가운데에서 둥근 ㄹㅋ 마크가 살짝 튀어 오르며 나타나기
        const k = Math.min(1, e / 0.8);
        morph.setAttribute('d', r0); morph.style.fill = mix(0); morph.style.opacity = Math.min(1, e / 0.35);
        morph.setAttribute('transform', scaleAt(0.6 + 0.4 * backOut(k)));
      } else if (e < 1.15) { // 2) 잠깐 머물기
        morph.setAttribute('d', r0); morph.style.opacity = 1; morph.setAttribute('transform', '');
      } else if (e < 2.55) { // 3) 한반도 모양으로 부풀어 오르며 녹아들기
        const k = sine(Math.min(1, (e - 1.15) / 1.4));
        morph.setAttribute('d', interp(k)); morph.style.fill = mix(k);
      } else { // 4) 실제 경계 지도로 교체
        layers.forEach((l) => { l.style.transition = ''; l.style.opacity = 1; });
        morph.style.transition = 'opacity .6s'; morph.style.opacity = 0;
        setTimeout(() => { morph.setAttribute('d', ''); morph.style.transition = ''; }, 620);
        setTimeout(() => wrap.classList.remove('intro'), 1400); // 핀 등장 애니메이션 끝나면 해제(다시 그릴 때 깜빡임 방지)
        return;
      }
      introRaf = requestAnimationFrame(step);
    };
    introRaf = requestAnimationFrame(step);
  }

  // 첫 화면: 예시 장바구니를 담아 계산 기능이 보이게
  const pick = (rid, cat, i = 0) => (placesOf(rid).filter((p) => p.category === cat)[i] || {}).id;
  const cartOf = (ids) => ids.filter(Boolean).map((pid) => ({ pid, qty: defaultQty(PM[pid]) }));
  S.cart = cartOf([pick('geochang', 'food'), pick('geochang', 'stay'), pick('geochang', 'cafe'), pick('hamyang', 'food')]); S.basket = 'geochang';
  if (CLOUD) {
    Object.assign(DB, { user: null, alarms: {}, trips: [], posts: [], likes: {} });
    let first = true;
    CLOUD.onAuth((user) => {
      if (first) { first = false; return; } // 첫 호출은 아래 refreshCloud 가 처리
      linkSent = '';
      if (user && S.panel !== 'my' && !(DB.user && DB.user.id === user.id)) openPanel('my');
      if (!user) toast('로그아웃했어요');
      refreshCloud();
    });
  }
  setVB(VB0.slice()); renderAll(); playIntro();
  if (CLOUD) refreshCloud(); else checkAlarms();
  if (loginErr) setTimeout(() => openPanel('my'), 400);
  history.replaceState({ ...snap(), i: 0 }, '');

  // 홈 화면 설치(PWA) — 지원되는 곳에서만

  // 화면 캡처·발표용 상태 전환
  window.__demo = (k) => {
    if (k === 'home') { S.cart = []; goHome(); }
    if (k === 'region') openRegion('geochang');
    if (k === 'pop') { openRegion('geochang'); setTimeout(() => { S.pid = pick('geochang', 'food'); renderLeft(); renderOverlay(); }, 760); }
    if (k === 'trip') openTrip(true);
    if (k === 'sheet') setSheet('half');
    if (k === 'route') { S.cart = cartOf([pick('geochang', 'stay'), pick('geochang', 'food'), pick('geochang', 'cafe'), pick('geochang', 'spot', 1), pick('geochang', 'food', 1)]); renderAll(); toggleRoute(); }
  };
})();
