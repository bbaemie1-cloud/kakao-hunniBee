const fetch = globalThis.fetch;

async function fetchPublicPolicies(apiKey) {
  // If no API key is provided, return mock data for the hackathon MVP
  if (!apiKey || apiKey === 'YOUR_API_KEY') {
    console.log('[API Fetcher] No API key provided. Returning mock Open Data policies...');
    return [
      {
        id: 'api_mock_1',
        title: '청년 맞춤형 전월세 대출 지원',
        category: '대출',
        target_audience: '만 19세~34세 무주택 청년',
        benefits: '최대 1억원 전월세 보증금 대출 (연 1.2% ~ 2.1%)',
        deadline: '상시 모집',
        source_url: 'https://www.hf.go.kr/hf/sub01/sub01_01_01.do'
      },
      {
        id: 'api_mock_2',
        title: '소상공인 새희망자금 (가상)',
        category: '사업',
        target_audience: '연매출 4억 이하 소상공인',
        benefits: '최대 200만원 현금 지원',
        deadline: '2026-12-31',
        source_url: 'https://www.semas.or.kr/'
      }
    ];
  }

  // Example implementation for a real API (e.g. data.go.kr youth policy API)
  try {
    console.log('[API Fetcher] Fetching policies from public API...');
    const url = `https://www.youthcenter.go.kr/opi/empList.do?openApiVlak=${apiKey}&display=10&pageIndex=1`;
    const response = await fetch(url);
    const xmlData = await response.text();
    // In a real app, parse XML to JSON here (e.g., using fast-xml-parser).
    // For MVP, we fallback to mock if real fetch is attempted but not fully implemented.
    return [];
  } catch (error) {
    console.error('[API Fetcher] Error fetching policies:', error);
    return [];
  }
}

module.exports = { fetchPublicPolicies };
