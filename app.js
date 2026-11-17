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
  const S = { view: 'all', rid: null, cat: 'all', pid: null, filter: 'all', people: 2, mode: 'normal', cart: [], route: null, basket: 'all', order: {}, panel: null };

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
        h += `<button type="button" class="pin hit ${r.status}" data-r="${r.id}" style="animation-delay:${d}s" aria-label="${r.name} ${STL[r.status]}"><span class="pd"></span>${r.short}${r.tour_resident_card ? '<sup>★</sup>' : ''}</button>`;
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
    const notes = p.sample ? '장소·가격은 화면 설계용 예시입니다.'
      : [p.approx ? '지도 위치는 지역 안 근사 위치예요.' : '', p.merchant !== '예' ? '반값여행 환급은 지역화폐 가맹점 결제만 인정돼요.' : ''].filter(Boolean).join(' ');
    return `<div class="pop" data-p="${p.id}" role="dialog" aria-label="${esc(p.name)}">
      <button class="x" type="button" data-close aria-label="닫기">✕</button>
      <div class="cat-l" style="color:${CAT[p.category].c}">${CAT[p.category].n} · ${r.name}</div>
      <h3>${esc(p.name)}</h3>
      <dl>${rows}
      <dt>계산 단가</dt><dd class="num">${p.price ? won(p.price) + (p.category === 'stay' ? ' / 1박·객실' : ' / 1인') : '무료'}</dd></dl>
      <div class="links"><a href="${map}" target="_blank" rel="noopener">카카오맵에서 보기</a>${safeUrl(p.source_url) ? `<a href="${safeUrl(p.source_url)}" target="_blank" rel="noopener">출처</a>` : ''}${p.category === 'stay' ? '<span>예약 링크 (제휴 연동 예정)</span>' : ''}</div>
      <button class="btn${inCart ? ' added' : ''}" type="button" data-add="${p.id}">${inCart ? '담김 · 빼기' : '장바구니에 담기'}</button>
      ${notes ? `<div class="ex">${notes}</div>` : ''}</div>`;
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
    const k = r.rule, rows = [['현재 일정', r.round || r.period], ['사업 기간', r.period], ['환급 한도', `${capText(k)} (경비의 50%)`],
      ['최소 소비', minText(k.min_spend)], ['청년·가족', brief(r.perks_text) || '확인 필요'], ['환급 수단', r.currency], ['사전신청', brief(r.apply)]];
    return `<div class="src rinfo"><b>반값여행 신청 안내</b>
      <dl>${rows.filter((x) => x[1]).map(([t, d]) => `<dt>${t}</dt><dd>${esc(d)}</dd>`).join('')}</dl>
      확인일 ${esc(r.status_checked_at)} · 팀 수집 시트 기준, 최종 조건은 지자체 공고를 확인하세요.<br>
      ${safeUrl(r.site) ? `<a href="${safeUrl(r.site)}" target="_blank" rel="noopener">${r.name} 신청 페이지 열기 ›</a>` : ''}</div>`;
  }
  function renderLeft() {
    const L = $('left');
    if (S.view === 'all') {
      let h = `<p class="p-title">지역별 진행 현황${S.filter !== 'all' ? ` · ${STL[S.filter]}` : ''}</p>
        <p class="note">예산 소진 시 조기 마감 · 상태는 ${$('checked').textContent} 확인 · 팀 수집 시트 기준</p>`;
      SIDO_ORDER.forEach((sd) => {
        const rs = R.filter((r) => r.sido === sd && (S.filter === 'all' || r.status === S.filter)); if (!rs.length) return;
        h += `<div class="rgroup">${sd}</div>` + rs.map((r) => `<button type="button" class="ritem" data-r="${r.id}"><span class="dot ${r.status}"></span><span class="nm">${r.name}</span>${r.tour_resident_card ? '<span class="star">★</span>' : ''}${r.half.includes('신규') ? '<span class="tag">하반기 신규</span>' : ''}${DB.alarms[r.id] ? '<span class="bell-on" title="신청 알림 받는 중">🔔</span>' : ''}<span class="st ${r.status}">${STL[r.status]}</span></button>`).join('');
      });
      L.innerHTML = h; return;
    }
    const r = RM[S.rid];
    const ps = placesOf(r.id).filter((p) => S.cat === 'all' || p.category === S.cat);
    const cats = [['all', '전체'], ...Object.entries(CAT).map(([k, v]) => [k, v.n])];
    L.innerHTML = `<button type="button" class="back" data-home>← 전국 지도</button>
      <div class="rcard"><div class="sil">${silhouette(r)}</div>
        <div class="rc-main"><div class="rhead"><h2>${r.name}</h2><span class="pill ${r.status}">${STL[r.status]}</span>${alarmBtn(r)}</div>
        <div class="rsub">${r.sido} · ${r.half.includes('신규') ? '하반기 신규 지역' : '상반기부터 운영'}${r.tour_resident_card ? ' · <span class="star">★</span> 관광주민증 혜택' : ''}</div></div></div>
      <div class="facts">${geoFacts(r)}</div>
      ${regionInfo(r)}
      <div class="tabs" role="tablist">${cats.map(([k, n]) => `<button type="button" class="tab" role="tab" data-cat="${k}" aria-selected="${S.cat === k}">${n}</button>`).join('')}</div>
      <div>${ps.map((p) => `<button type="button" class="pitem${S.pid === p.id ? ' on' : ''}" data-p="${p.id}"><span class="pic" style="background:${CAT[p.category].c}">${CAT[p.category].k}</span><span><span class="nm">${esc(p.name.replace(r.short + ' ', ''))}</span><span class="sub">${p.price_text} · ${p.access_text}</span></span></button>`).join('')}</div>`;
  }
  // 장바구니는 '가는 지역'별 바구니로 나눈다
  const groups = () => { const g = {}; S.cart.forEach((c) => { const rid = PM[c.pid].region_id; (g[rid] = g[rid] || []).push(c); }); return g; };
  function renderBadge() { const n = S.cart.length, b = $('badge'); b.hidden = !n; b.textContent = n; }

  /* ───────── 신청 알림: 알림을 켠 지역이 '신청접수중'이 되면 알려 준다 ───────── */
  function alarmBtn(r) {
    const on = !!DB.alarms[r.id];
    return `<button type="button" class="alarm${on ? ' on' : ''}" data-alarm="${r.id}" aria-pressed="${on}" title="${r.status === 'open' ? '신청 상태가 바뀌면 알림' : '신청 시작 알림'}">
      <svg viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0" fill="none" stroke-linecap="round"/></svg>${on ? '알림 켜짐' : '신청 알림'}</button>`;
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
    $('barl').innerHTML = Object.entries(byCat).map(([k, v]) => `<span><span class="dot" style="background:${CAT[k].c}"></span>${CAT[k].n} <b class="num">${won(v)}</b></span>`).join('');
    let refund = 0, rg = '';
    Object.entries(byR).forEach(([rid, a]) => { const f = refundOf(rid, a); refund += f.v; rg += `${RM[rid].name} ${won(a)} → 환급 ${won(f.v)}${f.why ? ` (${f.why})` : ''}${RM[rid].status === 'closed' ? ' (현재 마감)' : ''}<br>`; });
    const only = Object.keys(byR).length === 1 ? refundOf(...Object.entries(byR)[0]) : null;
    const sumLabel = only ? only.ru.label + (only.why ? ' · ' + only.why : '') : MODE[S.mode];
    const n = nights(), scope = S.basket === 'all' ? '전체 바구니' : (RM[S.basket] ? RM[S.basket].name + ' 바구니' : '');
    $('sum').innerHTML = `<div class="row"><span>${scope ? scope + ' · ' : ''}여행 기간</span><b class="num">${n}박 ${n + 1}일 · ${S.people}명</b></div>
      <div class="row"><span>예상 경비 합계</span><b class="num">${won(total)}</b></div>
      <div class="row refund"><span>반값여행 환급 예상 (${sumLabel})</span><b class="num">− ${won(refund)}</b></div>
      ${rg && Object.keys(byR).length > 1 ? `<div class="rg num">${rg}</div>` : ''}
      <div class="row total"><span>실제 부담 예상</span><b class="num">${won(total - refund)}</b></div>
      ${S.cart.length ? `<button type="button" class="btn save-trip" data-save-trip>이 여행 저장하기</button>` : ''}
      <p class="fine">반값여행은 지역마다 따로 신청·정산하므로 바구니도 지역별로 나눠 계산합니다. 환급은 지역화폐 가맹점 결제만 인정되고 지역사랑상품권으로 지급되며, 비율·한도·최소 소비 금액은 해당 지자체 공고가 최종 기준입니다.</p>`;
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
    if (ids.length < 2) { box.innerHTML = `<div class="route-h"><b>내 코스 <small>한 지역에 장소 2곳 이상 담으면 순서를 정할 수 있어요</small></b></div>`; return; }
    let tot = 0;
    const li = ids.map((id, i) => { const p = PM[id]; const d = i ? km(PM[ids[i - 1]], p) : 0; tot += d;
      return `<li><span class="k">${i + 1}</span><span class="nm2">${esc(p.name)}</span><span class="leg num">${i ? '+' + d.toFixed(1) + 'km' : '출발'}</span>
        <span class="mv"><button type="button" data-mv="${id}" data-d="-1" aria-label="${esc(p.name)} 앞으로"${i ? '' : ' disabled'}>↑</button><button type="button" data-mv="${id}" data-d="1" aria-label="${esc(p.name)} 뒤로"${i < ids.length - 1 ? '' : ' disabled'}>↓</button></span></li>`; }).join('');
    const approx = ids.some((id) => PM[id].approx || PM[id].sample);
    box.innerHTML = `<div class="route-h"><b>내 코스 · ${RM[rid].name} <small>직선 ${tot.toFixed(1)}km</small></b>
      <button type="button" class="btn2${S.route ? ' on' : ''}" data-route>${S.route ? '지도에서 끄기' : '지도에서 보기'}</button></div>
      <ol class="rsteps">${li}</ol>
      <div class="rbtns"><button type="button" class="btn3" data-autosort>가까운 순으로 정렬</button><a class="btn3" href="${kakaoRoute(ids)}" target="_blank" rel="noopener">카카오맵 길찾기</a></div>
      <p class="rnote">↑↓로 원하는 순서를 정하면 그 순서대로 지도·길찾기에 반영돼요. 길찾기는 카카오맵 앱·웹으로 열려요(최대 6곳).${approx ? ' 지금은 일부 장소 위치가 근사값이라 길찾기 위치가 정확하지 않을 수 있어요.' : ''}</p>`;
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
        if (r.needConfirm) { linkSent = email; loginErr = ''; renderMy(); toast('확인 메일을 보냈어요. 메일의 링크를 누르면 가입이 끝나요'); return; }
      } else await CLOUD.signIn(email, pw);
    } catch (e) {
      console.warn(e); btn.disabled = false; btn.textContent = label;
      const m = e.message || '';
      toast(/Invalid login/i.test(m) ? '이메일 또는 비밀번호가 맞지 않아요. 처음이면 가입하기를 눌러 주세요'
        : /already registered|already been registered/i.test(m) ? '이미 가입한 이메일이에요. 로그인을 눌러 주세요'
        : /not confirmed/i.test(m) ? '가입 확인 메일의 링크를 먼저 눌러 주세요'
        : /rate|seconds/i.test(m) ? '너무 자주 시도했어요. 잠시 후 다시 해 주세요'
        : /password/i.test(m) ? '비밀번호가 너무 약해요. 더 길게 만들어 주세요' : '로그인하지 못했어요. 잠시 후 다시 해 주세요');
    }
  }
  async function emailLogin(btn) {
    const email = ($('loginEmail').value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('이메일 주소를 확인해 주세요'); return $('loginEmail').focus(); }
    btn.disabled = true; btn.textContent = '보내는 중…';
    try { await CLOUD.sendLink(email); linkSent = email; loginErr = ''; renderMy(); setTimeout(() => $('loginCode') && $('loginCode').focus(), 50); }
    catch (e) { console.warn(e); btn.disabled = false; btn.textContent = '로그인 링크 받기';
      toast(/rate|seconds/i.test(e.message || '') ? '메일을 너무 자주 요청했어요. 잠시 후 다시 해 주세요' : '메일을 보내지 못했어요. 주소를 확인해 주세요'); }
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
    if (S.panel === 'community') renderCommunity();
    if (DB.user && DB.user.name) { checkAlarms(); migrateLocal(); }
  }

  /* ───────── 커뮤니티: 지역별 여행 코스 나누기 ───────── */
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
  let cFilter = 'all', writing = false;
  const allPosts = () => DB.posts.concat(SEED);
  function renderCommunity() {
    const box = $('community'), posts = allPosts(), rids = [...new Set(posts.map((p) => p.rid))].filter((rid) => RM[rid]);
    const list = posts.filter((p) => RM[p.rid] && (cFilter === 'all' || p.rid === cFilter));
    const crid = courseRid(), cids = crid ? courseIds(crid) : [];
    const form = !writing ? '' : `<div class="wform">
      <h4 class="sec">내 코스 공유하기</h4>
      ${cids.length >= 2 ? `<p class="fine">장바구니의 <b>${RM[crid].name}</b> 코스(${cids.length}곳, 내가 정한 순서)를 올려요.</p>
        <ol class="rsteps small">${cids.map((id, i) => `<li><span class="k">${i + 1}</span><span class="nm2">${esc(PM[id].name)}</span></li>`).join('')}</ol>
        <label class="fld"><span>제목</span><input id="pTitle" maxlength="40" placeholder="예: ${RM[crid].short} 1박 2일 먹방 코스"></label>
        <label class="fld"><span>한 줄 팁</span><textarea id="pMemo" rows="3" maxlength="300" placeholder="이동 순서, 최소 소비 맞추는 팁 등"></textarea></label>
        <div class="rbtns"><button type="button" class="btn" data-post>올리기</button><button type="button" class="btn3" data-write>취소</button></div>`
      : `<p class="empty">한 지역에 장소를 2곳 이상 담고 장바구니의 '내 코스'에서 순서를 정하면 공유할 수 있어요.</p><div class="rbtns"><button type="button" class="btn3" data-write>닫기</button></div>`}</div>`;
    box.innerHTML = `<div class="c-head"><p>지역별로 다녀온 코스를 나누고, 마음에 드는 코스는 장바구니에 바로 담아 보세요.</p>${writing ? '' : '<button type="button" class="btn" data-write>코스 쓰기</button>'}</div>
      ${form}
      <div class="fchips in-page">${[['all', '전체']].concat(rids.map((rid) => [rid, RM[rid].name])).map(([k, n]) => `<button type="button" class="fchip" data-cf="${k}" aria-pressed="${cFilter === k}">${n}</button>`).join('')}</div>
      ${list.map((p) => { const mine = !!p.mine, liked = !!DB.likes[p.id];
        return `<article class="post"><div class="ph"><span class="pill ${RM[p.rid].status}">${RM[p.rid].name}</span>${p.sample ? '<span class="tag2">예시 글</span>' : ''}<b>${esc(p.title)}</b></div>
          <div class="pm">${esc(p.author)} · ${esc(p.at)}</div>
          <ol class="rsteps small">${p.ids.filter((id) => PM[id]).map((id, i) => `<li><span class="k">${i + 1}</span><span class="nm2">${esc(PM[id].name)}</span></li>`).join('')}</ol>
          ${p.memo ? `<p class="pmemo">${esc(p.memo)}</p>` : ''}
          <div class="pf"><button type="button" class="like${liked ? ' on' : ''}" data-like="${p.id}" aria-pressed="${liked}">♥ <span class="num">${(p.likes || 0) + (liked ? 1 : 0)}</span></button><span><button type="button" class="btn3" data-take="${p.id}">코스 담기</button>${mine ? `<button type="button" class="x2" data-del-post="${p.id}">삭제</button>` : ''}</span></div></article>`; }).join('') || '<p class="empty">아직 이 지역 코스가 없어요.</p>'}
      <p class="fine">${CLOUD ? '올린 코스는 로컬로 사용자 모두에게 보여요. 예시 글은 화면 설계용이에요.' : '서버에 연결하지 못해 글이 이 기기에만 저장돼요.'}</p>`;
  }
  async function postCourse() {
    const rid = courseRid(), ids = rid ? courseIds(rid) : [], title = ($('pTitle') || {}).value || '';
    if (ids.length < 2) return;
    if (!title.trim()) { toast('제목을 적어 주세요'); $('pTitle').focus(); return; }
    const post = { id: uid(), rid, title: title.trim(), memo: ($('pMemo').value || '').trim(), ids, author: DB.user.name, at: today(), likes: 0, mine: true };
    if (!(await cloud(async (c) => { post.id = await c.addPost(post); return true; }, '코스를 올리지 못했어요'))) return;
    DB.posts.unshift(post); save(); writing = false; cFilter = rid; renderCommunity(); toast('코스를 올렸어요');
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
  function goHome() { S.view = 'all'; S.rid = null; S.pid = null; renderAll(); animateVB(VB0.slice(), 650, () => { layoutPins(); placeOverlay(); }); record(); }

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
    S.pid = null; renderLeft(); renderOverlay(); record();
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
    if (name === 'community') renderCommunity();
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
    if (t.hasAttribute('data-logout')) { if (CLOUD) { CLOUD.signOut(); return; } DB.user = null; save(); renderMy(); return toast('로그아웃했어요'); }
    if (t.hasAttribute('data-write')) { if (!writing && !needLogin('코스 쓰기')) return; if (!writing && !DB.user.name) { openPanel('my'); return toast('닉네임을 먼저 정해 주세요'); } writing = !writing; return renderCommunity(); }
    if (t.hasAttribute('data-post')) return postCourse();
    if (d.cf) { cFilter = d.cf; return renderCommunity(); }
    if (d.like) {
      const id = d.like, post = allPosts().find((x) => x.id === id);
      if (CLOUD && post && !post.sample) { // 서버 글: 로그인 필요
        if (!needLogin('좋아요')) return;
        if (DB.likes[id]) { delete DB.likes[id]; cloud((c) => c.unlike(id)); } else { DB.likes[id] = 1; cloud((c) => c.like(id)); }
      } else if (DB.likes[id]) delete DB.likes[id]; else DB.likes[id] = 1; // 예시 글·시제품: 화면에서만
      save(); return renderCommunity();
    }
    if (d.take) return takeCourse(d.take);
    if (d.delPost) { const id = d.delPost; DB.posts = DB.posts.filter((x) => x.id !== id); save(); cloud((c) => c.delPost(id)); return renderCommunity(); }
    if (d.m) { S.mode = d.m; document.querySelectorAll('#mode button').forEach((b) => b.setAttribute('aria-pressed', b === t)); renderStack(); return; }
    if (t.id === 'pm' || t.id === 'pl') return setPeople(S.people + (t.id === 'pl' ? 1 : -1));
    if (d.basket) { S.basket = d.basket; S.route = null; drawRoute(); renderStack(); renderRoute(); renderOverlay(); return; }
    if (t.hasAttribute('data-route')) return toggleRoute();
    if (t.id === 'replay') { playIntro(); return record(); }
    if (d.tab) return openPanel(d.tab === 'map' ? null : d.tab);
    if (d.soon) return toast(`${d.soon}은 다음 단계에서 열려요`);
  });
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
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

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
