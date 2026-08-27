/**
 * compositeFont.js
 * 인디자인 합성 글꼴 세팅 포맷터 모듈
 * 
 * - 구두점, 기호: SM3세명조 크기 100%, 기준선 0%, 세로 100%, 가로 100% (.comp-punct)
 * - 한글:        SM3세명조 크기 100%, 기준선 0%, 세로 100%, 가로 97%  (.comp-hangul)
 * - 라틴 문자:    SM3나루   크기 85%,  기준선 5%, 세로 100%, 가로 95%  (.comp-latin)
 * - 숫자:        Fort Light 크기 95%, 기준선 1%, 세로 100%, 가로 90%  (.comp-number)
 */

const CompositeFontFormatter = (() => {
  // 문자별 타입 판별
  function getType(ch) {
    // 1. 숫자 (변형 없음)
    if (/[0-9]/.test(ch)) {
      return 'number';
    }

    // 2. 한글 (완성형, 자모, 호환자모 등)
    if (/[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/.test(ch)) {
      return 'hangul';
    }

    // 3. 라틴 문자 (기본 라틴, 확장 라틴)
    if (/[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/.test(ch)) {
      return 'latin';
    }

    // 4. 구두점 및 기호
    if (/[.,;:'"!?()\[\]{}<>«»“”‘’"'…\-–—/\\~@#$%^&*+=|_§¶†‡•·ㆍ『』「」【】〔〕〈〉《》\u2000-\u206F\u2E00-\u2E7F\u3000-\u303F\uFF00-\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF65]/.test(ch)) {
      return 'punct';
    }

    // 5. 기타 (공백 등)
    return 'other';
  }

  // 안전한 HTML 이스케이프
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>');
  }

  // 청크(Chunk) 단위 span 감싸기
  function wrapChunk(chunk, type) {
    const safeChunk = escapeHtml(chunk);

    switch (type) {
      case 'hangul':
        return `<span class="comp-hangul">${safeChunk}</span>`;
      case 'latin':
        return `<span class="comp-latin">${safeChunk}</span>`;
      case 'punct':
        return `<span class="comp-punct">${safeChunk}</span>`;
      case 'number':
        return `<span class="comp-number">${safeChunk}</span>`;
      case 'other':
      default:
        return safeChunk;
    }
  }

  /**
   * 텍스트 문자열을 합성 글꼴 HTML로 파싱
   * @param {string} text - 원본 텍스트
   * @returns {string} - 합성 글꼴 span 태그가 적용된 HTML 문자열
   */
  function format(text) {
    if (!text) return '';

    let result = '';
    let currentChunk = '';
    let currentType = null;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const type = getType(ch);

      if (type !== currentType && currentChunk.length > 0) {
        result += wrapChunk(currentChunk, currentType);
        currentChunk = '';
      }
      currentType = type;
      currentChunk += ch;
    }

    if (currentChunk.length > 0) {
      result += wrapChunk(currentChunk, currentType);
    }

    return result;
  }

  /**
   * 특정 DOM 요소의 textContent를 읽어서 합성 글꼴 HTML로 적용
   * @param {HTMLElement|string} target - DOM 요소 또는 element ID
   * @param {string} [customText] - 지정 텍스트가 있을 경우 사용
   */
  function applyToElement(target, customText) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;

    const rawText = customText !== undefined ? customText : el.textContent;
    el.innerHTML = format(rawText);
  }

  return {
    format,
    applyToElement
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CompositeFontFormatter;
}

