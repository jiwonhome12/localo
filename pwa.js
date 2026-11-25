if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.warn('오프라인 기능을 시작하지 못했습니다.', error);
    });
  });
}
