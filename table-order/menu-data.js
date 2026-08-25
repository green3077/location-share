// 메뉴 데이터 - 실제 매장 메뉴로 교체할 때 이 파일만 수정하면 됩니다.
const MENU_DATA = {
  categories: [
    { id: "recommend", name: { ko: "추천메뉴", en: "Recommended" } },
    { id: "chicken", name: { ko: "치킨", en: "Chicken" } },
    { id: "side", name: { ko: "사이드", en: "Sides" } },
    { id: "bunsik", name: { ko: "분식", en: "Snacks" } },
    { id: "drink", name: { ko: "음료&주류", en: "Drinks" } },
  ],

  items: [
    // 추천메뉴
    { id: "r1", categoryId: "recommend", name: { ko: "후라이드 치킨", en: "Fried Chicken" }, price: 19000, emoji: "🍗", badge: "popular" },
    { id: "r2", categoryId: "recommend", name: { ko: "양념 치킨", en: "Seasoned Chicken" }, price: 20000, emoji: "🍗", badge: "popular" },
    { id: "r3", categoryId: "recommend", name: { ko: "떡볶이", en: "Tteokbokki" }, price: 8000, emoji: "🌶️", badge: "popular" },
    { id: "r4", categoryId: "recommend", name: { ko: "생맥주 500cc", en: "Draft Beer 500cc" }, price: 4500, emoji: "🍺" },

    // 치킨
    { id: "c1", categoryId: "chicken", name: { ko: "후라이드 치킨", en: "Fried Chicken" }, price: 19000, emoji: "🍗", badge: "popular" },
    { id: "c2", categoryId: "chicken", name: { ko: "양념 치킨", en: "Seasoned Chicken" }, price: 20000, emoji: "🍗", badge: "popular" },
    { id: "c3", categoryId: "chicken", name: { ko: "간장 치킨", en: "Soy Sauce Chicken" }, price: 20000, emoji: "🍗" },
    { id: "c4", categoryId: "chicken", name: { ko: "반반 치킨(후라이드/양념)", en: "Half & Half Chicken" }, price: 21000, emoji: "🍗" },
    { id: "c5", categoryId: "chicken", name: { ko: "마늘 치킨", en: "Garlic Chicken" }, price: 21000, emoji: "🧄" },
    { id: "c6", categoryId: "chicken", name: { ko: "순살 치킨", en: "Boneless Chicken" }, price: 22000, emoji: "🍗", badge: "new" },

    // 사이드
    { id: "s1", categoryId: "side", name: { ko: "감자튀김", en: "French Fries" }, price: 5000, emoji: "🍟" },
    { id: "s2", categoryId: "side", name: { ko: "치즈볼", en: "Cheese Balls" }, price: 6000, emoji: "🧀" },
    { id: "s3", categoryId: "side", name: { ko: "웨지감자", en: "Potato Wedges" }, price: 6000, emoji: "🥔" },
    { id: "s4", categoryId: "side", name: { ko: "콜슬로", en: "Coleslaw" }, price: 4000, emoji: "🥗" },

    // 분식
    { id: "b1", categoryId: "bunsik", name: { ko: "떡볶이", en: "Tteokbokki" }, price: 8000, emoji: "🌶️" },
    { id: "b2", categoryId: "bunsik", name: { ko: "순대", en: "Sundae" }, price: 7000, emoji: "🥟" },
    { id: "b3", categoryId: "bunsik", name: { ko: "튀김모둠", en: "Assorted Fritters" }, price: 7000, emoji: "🍤" },
    { id: "b4", categoryId: "bunsik", name: { ko: "김밥", en: "Gimbap" }, price: 4000, emoji: "🍙" },

    // 음료&주류
    { id: "d1", categoryId: "drink", name: { ko: "콜라", en: "Cola" }, price: 2000, emoji: "🥤" },
    { id: "d2", categoryId: "drink", name: { ko: "사이다", en: "Sprite" }, price: 2000, emoji: "🥤" },
    { id: "d3", categoryId: "drink", name: { ko: "생맥주 500cc", en: "Draft Beer 500cc" }, price: 4500, emoji: "🍺" },
    { id: "d4", categoryId: "drink", name: { ko: "소주", en: "Soju" }, price: 5000, emoji: "🍶" },
    { id: "d5", categoryId: "drink", name: { ko: "하이볼", en: "Highball" }, price: 7000, emoji: "🥃" },
  ],
};
