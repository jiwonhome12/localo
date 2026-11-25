/* 로컬로 ↔ Supabase 연결
   - 공개 키(publishable)만 쓴다. 데이터 보호는 supabase/schema.sql 의 RLS가 맡는다.
   - service_role(secret) 키는 절대 여기에 넣지 않는다.
   - supabase-js 를 못 불러오면 window.LocaloCloud 는 null → app.js 가 이 기기 저장(시제품) 방식으로 동작한다. */
(function () {
  const URL = 'https://urqfwgtlolssnejguitt.supabase.co';
  const KEY = 'sb_publishable_xlgNDKTMpVqP40j1xTfV8g_GzNiQDOj';
  const START = { hash: location.hash || '', search: location.search || '' }; // 로그인 링크로 돌아온 값(라이브러리가 지우기 전에 보관)
  if (!window.supabase || !window.supabase.createClient) { window.LocaloCloud = null; return; }
  const sb = window.supabase.createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const must = ({ data, error }) => { if (error) throw error; return data; };
  let me = null; // 로그인한 사용자 id

  const day = (ts) => String(ts || '').slice(0, 10);
  const toPost = (r, liked) => {
    const n = (r.likes && r.likes[0] && r.likes[0].count) || 0;
    return { id: r.id, rid: r.region_id, title: r.title, memo: r.memo, ids: r.place_ids || [], images: r.images || [], at: day(r.created_at),
      author: (r.profiles && r.profiles.nickname) || '여행자', mine: !!me && r.user_id === me,
      likes: Math.max(0, n - (liked ? 1 : 0)) }; // 화면은 '남의 좋아요 + 내 좋아요'로 그린다
  };

  const BUCKET = 'post-images';
  const PUB = URL + '/storage/v1/object/public/' + BUCKET + '/';
  const back = () => new window.URL('./', location.href.replace(/[?#].*$/, '')).href; // 메일 링크가 돌아올 주소(첫 화면)
  const rand = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  window.LocaloCloud = {
    // 로그인 상태 바뀔 때마다 cb(user|null)
    onAuth(cb) {
      sb.auth.onAuthStateChange((_e, session) => { me = session ? session.user.id : null; cb(session ? session.user : null); });
    },
    async session() { const { data } = await sb.auth.getSession(); me = data.session ? data.session.user.id : null; return data.session ? data.session.user : null; },
    // 이메일로 로그인 링크 보내기. 링크를 누르면 첫 화면(index.html)으로 돌아와 로그인된다
    async sendLink(email) {
      must(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: back() } }));
    },
    // 이메일 + 비밀번호
    async signIn(email, password) { must(await sb.auth.signInWithPassword({ email, password })); },
    // 가입: 대시보드에서 'Confirm email'을 끄면 바로 로그인된다(켜져 있으면 확인 메일을 눌러야 함 → needConfirm)
    async signUp(email, password) {
      // 확인 메일 링크도 이 앱으로 돌아오게(없으면 대시보드의 Site URL로 가서 '페이지를 열 수 없음'이 된다)
      const data = must(await sb.auth.signUp({ email, password, options: { emailRedirectTo: back() } }));
      return { needConfirm: !data.session };
    },
    // 메일 속 숫자 코드로 로그인(링크가 안 열릴 때·다른 기기에서 메일을 볼 때)
    // 가입 확인 메일의 코드는 type 'signup' 이라 'email'로 실패하면 한 번 더 시도한다
    async verifyCode(email, token) {
      const r = await sb.auth.verifyOtp({ email, token, type: 'email' });
      if (r.error) must(await sb.auth.verifyOtp({ email, token, type: 'signup' }));
    },
    // 가입 확인 메일 다시 보내기
    async resendConfirm(email) { must(await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: back() } })); },
    // 로그인 링크로 돌아왔는데 실패한 경우(#error=…): 사람이 읽을 이유
    linkError() {
      const q = new window.URLSearchParams(START.hash.replace(/^#/, '') + '&' + START.search.replace(/^\?/, ''));
      const code = q.get('error_code') || q.get('error');
      if (!code) return '';
      history.replaceState(null, '', location.pathname);
      if (/expired/.test(code)) return '로그인 링크가 만료됐거나 이미 사용됐어요. 일부 메일 서비스는 보안 검사로 링크를 미리 열어 버려요. 메일 속 숫자 코드로 로그인해 주세요.';
      return '로그인 링크를 확인하지 못했어요(' + code + '). 메일 속 숫자 코드로 로그인해 주세요.';
    },
    async signOut() { await sb.auth.signOut(); me = null; },
    async profile() { return must(await sb.from('profiles').select('nickname, created_at').eq('id', me).maybeSingle()); },
    async setNickname(nickname) { must(await sb.from('profiles').upsert({ id: me, nickname })); },

    // 내 알림·지난 여행·좋아요
    async mine() {
      const [al, tr, lk] = await Promise.all([
        sb.from('alarms').select('region_id, last_status, created_at'),
        sb.from('trips').select('id, title, data, total, pay, created_at').order('created_at', { ascending: false }),
        sb.from('likes').select('post_id').eq('user_id', me),
      ]);
      const alarms = {}; must(al).forEach((a) => { alarms[a.region_id] = { status: a.last_status, at: day(a.created_at) }; });
      const trips = must(tr).map((t) => ({ ...t.data, id: t.id, title: t.title, total: t.total, pay: t.pay, savedAt: day(t.created_at) }));
      const likes = {}; must(lk).forEach((l) => { likes[l.post_id] = 1; });
      return { alarms, trips, likes };
    },
    async setAlarm(rid, status) { must(await sb.from('alarms').upsert({ user_id: me, region_id: rid, last_status: status })); },
    async delAlarm(rid) { must(await sb.from('alarms').delete().eq('region_id', rid)); },
    async addTrip(t) {
      const { id, title, total, pay, savedAt, ...data } = t;
      return must(await sb.from('trips').insert({ title, total, pay, data }).select('id').single()).id;
    },
    async delTrip(id) { must(await sb.from('trips').delete().eq('id', id)); },

    // 커뮤니티: 최근 글 100개(작성자 닉네임·좋아요 수·사진 포함)
    async posts(likedMap = {}) {
      const cols = 'id, user_id, region_id, title, memo, place_ids, created_at, profiles(nickname), likes(count)';
      let res = await sb.from('posts').select(cols + ', images').order('created_at', { ascending: false }).limit(100);
      if (res.error && /images/.test(res.error.message || '')) res = await sb.from('posts').select(cols).order('created_at', { ascending: false }).limit(100); // 스키마 최신본 실행 전
      return must(res).map((r) => toPost(r, !!likedMap[r.id]));
    },
    async addPost(p) {
      const row = { region_id: p.rid, title: p.title, memo: p.memo, place_ids: p.ids || [] };
      if (p.images && p.images.length) row.images = p.images;
      return must(await sb.from('posts').insert(row).select('id').single()).id;
    },
    async delPost(id, images = []) {
      must(await sb.from('posts').delete().eq('id', id));
      if (images.length) this.removeImages(images).catch(() => {});
    },
    // 글 사진: Storage 'post-images' 버킷의 '내 id/' 폴더에만 올릴 수 있다(schema.sql 정책)
    async uploadImage(blob) {
      const path = me + '/' + rand() + '.jpg';
      must(await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
      return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    },
    async removeImages(urls) {
      const paths = urls.filter((u) => this.isImageUrl(u)).map((u) => u.slice(PUB.length));
      if (paths.length) must(await sb.storage.from(BUCKET).remove(paths));
    },
    isImageUrl(u) { return typeof u === 'string' && u.startsWith(PUB) && !/[\s"'<>]/.test(u); },

    // 지역 검색 순위: 검색해서 고른 지역마다 +1, 많이 찾은 순 10곳
    async topSearches() {
      return must(await sb.from('region_searches').select('region_id, count').order('count', { ascending: false }).limit(10)).map((r) => ({ rid: r.region_id, count: Number(r.count) }));
    },
    async bumpSearch(rid) { must(await sb.rpc('bump_search', { rid })); },
    async like(id) { must(await sb.from('likes').insert({ post_id: id })); },
    async unlike(id) { must(await sb.from('likes').delete().eq('post_id', id).eq('user_id', me)); },
  };
})();
