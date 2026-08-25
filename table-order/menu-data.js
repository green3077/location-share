// 메뉴 데이터 - 실제 매장 메뉴/가격/사진으로 교체할 때 이 파일만 수정하면 됩니다.
// item.image 에 사진 파일 경로(예: "images/sundae-gukbap.jpg")를 넣으면
// 이모지 대신 실제 사진이 카드에 표시됩니다.
const MENU_DATA = {
  categories: [
    { id: "main", name: { ko: "메뉴", en: "Menu" } },
  ],

  items: [
    {
      id: "sundae-gukbap",
      categoryId: "main",
      name: { ko: "순대국밥", en: "Sundae Gukbap (Blood Sausage Soup)" },
      price: 9000,
      emoji: "🍲",
      image: null,
      badge: "popular",
    },
    {
      id: "sundae-jeongol",
      categoryId: "main",
      name: { ko: "순대전골", en: "Sundae Hot Pot" },
      price: 35000,
      emoji: "🍢",
      image: null,
      badge: "popular",
    },
    {
      id: "makguksu",
      categoryId: "main",
      name: { ko: "막국수", en: "Makguksu (Buckwheat Noodles)" },
      price: 9000,
      emoji: "🍜",
      image: null,
    },
  ],
};
