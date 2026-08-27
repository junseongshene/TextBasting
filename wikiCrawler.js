/**
 * wikiCrawler.js
 * 위키백과 API 연동 및 드래그 텍스트 기반 실시간 크롤링 모듈
 */

const WikiCrawler = (() => {
  // HTML 태그 제거 유틸리티
  function stripHtml(htmlStr) {
    if (!htmlStr) return '';
    const tmp = document.createElement('DIV');
    tmp.innerHTML = htmlStr;
    return tmp.textContent || tmp.innerText || '';
  }

  // 검색 후보로 쓸 가치가 없는 일반적인 조사/불용어 (첫 단어가 흔한 단어일 때 무의미한 검색 방지)
  const STOPWORDS = new Set([
    '물론', '각자', '그것', '이것', '저것', '이런', '저런', '그런', '어떤', '위해',
    '통해', '대해', '관해', '같이', '처럼', '그리고', '하지만', '그러나', '때문', '또한',
    '그런데', '그래서', '있다', '없다', '하는', '한다', '되다', '이다', '그', '이', '저', '등',
    // 문장 중간에서 잘려나온 동사/형용사 어간 등 명사가 아닌 조각
    '나쁘고', '나쁘', '아무데서나', '아무데', '불러올'
  ]);

  // 위키백과 검색 후 적합한 문서를 골라 반환 (실패 시 null)
  // - srlimit=3 결과를 순회하며 동음이의/빈약한 요약은 건너뛰고 첫 적합 문서를 반환한다.
  // - 적합 문서가 없으면 동음이의가 아닌 첫 요약을 스니펫으로라도 반환해 완전 실패를 막는다.
  async function searchAndPick(term) {
    const searchUrl = `https://ko.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&srlimit=3&utf8=1&format=json&origin=*`;
    const res = await fetch(searchUrl);
    if (!res.ok) return null;
    const data = await res.json();
    const results = (data.query && data.query.search) || [];
    if (results.length === 0) return null;

    let bestFallback = null;
    for (const r of results) {
      const summary = await fetchWikiSummary(r.title);
      if (!summary) continue;

      if (isGoodSummary(summary)) {
        return {
          title: summary.displayTitle,
          snippet: summary.extract,
          fullContent: `${summary.displayTitle} - ${summary.extract}`,
          source: `위키백과 (Wikipedia), 『${summary.displayTitle}』 항목 참조.`
        };
      }
      // 동음이의가 아닌 첫 요약을 최후 폴백으로 보관
      if (!bestFallback && summary.type !== 'disambiguation' && summary.type !== 'special') {
        bestFallback = summary;
      }
    }

    if (bestFallback) {
      return {
        title: bestFallback.displayTitle,
        snippet: bestFallback.extract,
        fullContent: `${bestFallback.displayTitle} - ${bestFallback.extract}`,
        source: `위키백과 (Wikipedia), 『${bestFallback.displayTitle}』 항목 참조.`
      };
    }
    return null;
  }

  // 위키백과 REST 요약 API 호출 (실패하거나 요약이 없으면 null)
  async function fetchWikiSummary(title) {
    const summaryUrl = `https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const res = await fetch(summaryUrl);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.extract) return null;
    return {
      displayTitle: data.title || title,
      extract: data.extract,
      type: data.type || ''
    };
  }

  // 실제 설명이 있는 문서인지 판정 (동음이의/특수/빈약한 요약은 부적합)
  function isGoodSummary(summary) {
    if (summary.type === 'disambiguation' || summary.type === 'special') return false;
    const t = (summary.extract || '').trim();
    if (t.length < 20) return false;
    if (/다음 뜻으로 쓰인다|다른 뜻|동음이의|관련 항목|참고하십시오/.test(t)) return false;
    return true;
  }

  // 한국어 조사/어미 제거 및 핵심 명사 키워드 추출
  function extractCoreTerms(rawText) {
    const cleaned = rawText.replace(/[^\w\s가-힣]/g, ' ').trim();
    if (!cleaned) return [];

    const words = cleaned.split(/\s+/);
    // 조사/어미/접속어미 제거 (명사 후보 추출)
    const particleRegex = /(은|는|이|가|을|를|으로|로|에|에서|와|과|도|의|들|이며|면서|거나|지만|는데|다고|라고|하고|하며|하여|하게|하는|하려고|니까|다가|하면|한|하다|이다|다|해)$/;

    const candidates = words
      .map(w => w.replace(particleRegex, ''))
      .filter(w => w.length >= 2 && !STOPWORDS.has(w))
      // 동사/형용사 어간의 '하'를 떼어 명사형으로 복원 (운동하→운동, 존재하→존재, 차용하→차용)
      .map(w => (w.length > 2 && /하$/.test(w)) ? w.slice(0, -1) : w)
      .filter(w => w.length >= 2);
    return candidates.length > 0 ? candidates : words;
  }

  // 선택한 텍스트 기반 위키백과 동적 API 크롤링
  // - 긴 본문을 문장 전체로 검색하면 관련성이 크게 떨어지므로, 추출한 핵심 명사를 먼저 검색한다.
  // - 불용어/동음이의 문서를 걸러 실제 설명이 있는 문서를 우선 반환한다.
  async function crawl(selectedText) {
    const coreTerms = extractCoreTerms(selectedText);
    // 핵심 명사는 불용어 제외·긴 단어 우선으로 정렬해 앞에서부터 시도 (최대 4개)
    const core = [...new Set(coreTerms.filter((t) => t && t.length >= 2))]
      .sort((a, b) => {
        const aw = STOPWORDS.has(a) ? 1 : 0;
        const bw = STOPWORDS.has(b) ? 1 : 0;
        if (aw !== bw) return aw - bw;
        return b.length - a.length;
      })
      .slice(0, 4);

    // 전체 문구는 정확한 문서명 매칭용으로 마지막 후보에 추가
    const candidates = [...core];
    if (selectedText && selectedText.length >= 2 && !candidates.includes(selectedText)) {
      candidates.push(selectedText);
    }

    for (const term of candidates) {
      try {
        const result = await searchAndPick(term);
        if (result) return result;
      } catch (err) {
        console.warn('[WikiCrawler] Query error:', err);
      }
    }

    // API 검색 결과 미반환 시 폴백 데이터 생성
    const shortTitle = selectedText.length > 15 ? selectedText.slice(0, 15) + '...' : selectedText;
    return {
      title: shortTitle,
      snippet: `'${selectedText}' 부분에 대한 선택 발췌 영역입니다.`,
      fullContent: `'${selectedText}' - 선택하신 본문 영역에 관한 내용입니다.`,
      source: '발췌 문구 참조.'
    };
  }

  // 드래그한 문서 제목으로 위키백과 요약을 크롤링해 출력 (연관된 내용)
  // - 실패하면 텍스트 시침질 RTF 폴백을 반환
  async function crawlByTitle(title) {
    if (!title) return getFallbackText();
    try {
      const summaryUrl = `https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const sumRes = await fetch(summaryUrl);
      if (sumRes.ok) {
        const sumData = await sumRes.json();
        const wikiTitle = sumData.title || title;
        const wikiExtract = sumData.extract || '';
        // 동음이의/빈약한 요약은 본문으로 부적합 → 텍스트 시침질 폴백으로 대체
        if (wikiExtract && isGoodSummary({ type: sumData.type, extract: wikiExtract })) {
          return {
            title: wikiTitle,
            snippet: wikiExtract,
            fullContent: `${wikiTitle} - ${wikiExtract}`,
            source: `위키백과 (Wikipedia), 『${wikiTitle}』 항목 참조.`
          };
        }
      }
    } catch (err) {
      console.warn('[WikiCrawler] Summary by title error:', err);
    }
    return getFallbackText();
  }

  // 텍스트 시침질.rtf 기반 폴백 제시문
  // - 드래그 없이 엮기를 누르거나, 위키백과에서 재귀 문서(동일 검색어)가 나오거나,
  //   관련 검색어가 없는 경우에 이 텍스트를 출력한다.
  // - 제목(title)은 RTF의 볼드된 글씨에서, 내용(body)은 그 본문에서 추출.
  // - rtf_citations.js의 RTF_CITATIONS(54개) 중 랜덤으로 하나를 고른다.
  function getFallbackText() {
    const list = (typeof RTF_CITATIONS !== 'undefined' && RTF_CITATIONS.length) ? RTF_CITATIONS : [];
    if (list.length === 0) {
      return {
        title: '텍스트 시침질',
        fullContent: '텍스트 시침질.rtf',
        source: '텍스트 시침질.rtf'
      };
    }
    const c = list[Math.floor(Math.random() * list.length)];
    return {
      title: c.title,
      fullContent: c.body,
      source: '텍스트 시침질.rtf'
    };
  }

  // 이전 팝업과 반드시 다른 제시문을 보장하는 무작위 위키백과 문서 크롤링
  // - 위키백과 무작위 문서 API로 문서를 뽑아 요약(extract)을 가져오고,
  //   excludeTitle(이전 팝업의 문서 제목)과 같은 제목이면 다시 시도한다.
  // - 다른 문서를 찾지 못하면(재귀/관련 없음) 텍스트 시침질 폴백을 반환한다.
  async function crawlRandomByTitle(excludeTitle) {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        // 무작위 문서 1건 요청
        const randUrl = `https://ko.wikipedia.org/w/api.php?action=query&list=random&rnnamespace=0&rnlimit=1&format=json&origin=*`;
        const randRes = await fetch(randUrl);
        const randData = await randRes.json();
        const wikiTitle = randData.query && randData.query.random && randData.query.random[0]
          ? randData.query.random[0].title
          : null;
        if (!wikiTitle) continue;

        // 문서 요약(extract) 크롤링
        const summaryUrl = `https://ko.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`;
        const sumRes = await fetch(summaryUrl);
        if (!sumRes.ok) continue;
        const sumData = await sumRes.json();
        const wikiExtract = sumData.extract || '';
        if (!wikiExtract) continue;
        // 동음이의/빈약한 요약은 건너뛰고 다른 문서로 재시도
        if (!isGoodSummary({ type: sumData.type, extract: wikiExtract })) continue;

        const fullCrawledText = `${wikiTitle} - ${wikiExtract}`;
        // 이전 팝업과 동일한 문서(제목)면 다시 시도
        if (excludeTitle && wikiTitle === excludeTitle) continue;

        return {
          title: wikiTitle,
          snippet: wikiExtract,
          fullContent: fullCrawledText,
          source: `위키백과 (Wikipedia), 『${wikiTitle}』 항목 참조.`
        };
      } catch (err) {
        console.warn('[WikiCrawler] Random query error:', err);
      }
    }

    // 다른 문서를 찾지 못하면(재귀 문서 / 관련 검색어 없음) 텍스트 시침질 폴백 사용
    return getFallbackText();
  }

  return {
    crawl,
    crawlByTitle,
    crawlRandomByTitle,
    getFallbackText,
    extractCoreTerms,
    stripHtml
  };
})();
