/**
 * 按地区顺序重新排列神社ID
 * 排序优先级：region → prefecture → province
 */

const fs = require('fs');
const path = require('path');

// 地区顺序
const REGION_ORDER = [
  '北海道・東北',
  '関東',
  '北陸',
  '東海',
  '近畿',
  '中国・四国',
  '九州・沖縄'
];

// 各地区内的都道府县顺序（从北到南/从东到西）
const PREFECTURE_ORDER = {
  '北海道・東北': ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'],
  '関東': ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '山梨県'],
  '北陸': ['新潟県', '富山県', '石川県', '福井県'],
  '東海': ['長野県', '岐阜県', '静岡県', '愛知県', '三重県'],
  '近畿': ['滋賀県', '京都', '大阪府', '兵庫県', '奈良県', '和歌山県'],
  '中国・四国': ['鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '兵庫県'],
  '九州・沖縄': ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']
};

// 读取数据
const shrinesPath = path.join(__dirname, '../src/data/shrines.json');
const shrines = JSON.parse(fs.readFileSync(shrinesPath, 'utf8'));

console.log(`读取到 ${shrines.length} 个神社`);

// 收集所有出现的 prefecture
const allPrefectures = new Set();
shrines.forEach(s => allPrefectures.add(s.prefecture));

// 排序函数
function compareShrine(a, b) {
  // 1. 按 region 排序
  const regionIndexA = REGION_ORDER.indexOf(a.region);
  const regionIndexB = REGION_ORDER.indexOf(b.region);
  if (regionIndexA !== regionIndexB) {
    return regionIndexA - regionIndexB;
  }

  // 2. 同一 region 内按 prefecture 排序
  const prefOrder = PREFECTURE_ORDER[a.region] || [];
  const prefIndexA = prefOrder.indexOf(a.prefecture);
  const prefIndexB = prefOrder.indexOf(b.prefecture);
  // 如果不在列表中，放到最后
  const effectivePrefIndexA = prefIndexA === -1 ? 999 : prefIndexA;
  const effectivePrefIndexB = prefIndexB === -1 ? 999 : prefIndexB;
  if (effectivePrefIndexA !== effectivePrefIndexB) {
    return effectivePrefIndexA - effectivePrefIndexB;
  }

  // 3. 同一 prefecture 内按 province（令制国）排序（字母序）
  const provinceA = a.province || '';
  const provinceB = b.province || '';
  if (provinceA !== provinceB) {
    return provinceA.localeCompare(provinceB, 'ja');
  }

  // 4. 同一 province 内按神社名排序
  return (a.name || '').localeCompare(b.name || '', 'ja');
}

// 排序
const sorted = [...shrines].sort(compareShrine);

// 重新编号
const reordered = sorted.map((shrine, index) => ({
  ...shrine,
  id: index + 1
}));

// 按地区分组统计
const byRegion = {};
for (const shrine of reordered) {
  if (!byRegion[shrine.region]) {
    byRegion[shrine.region] = [];
  }
  byRegion[shrine.region].push(shrine);
}

// 显示各地区数量
console.log('\n各地区神社数量:');
for (const region of REGION_ORDER) {
  const count = byRegion[region]?.length || 0;
  console.log(`  ${region}: ${count}`);
}

// 检查是否有未知地区
const unknownRegions = Object.keys(byRegion).filter(r => !REGION_ORDER.includes(r));
if (unknownRegions.length > 0) {
  console.log('\n⚠️ 发现未知地区:', unknownRegions);
}

// 检查是否有未知县
const knownPrefectures = new Set(Object.values(PREFECTURE_ORDER).flat());
const unknownPrefectures = [...allPrefectures].filter(p => !knownPrefectures.has(p));
if (unknownPrefectures.length > 0) {
  console.log('\n⚠️ 发现未知都道府县:', unknownPrefectures);
}

console.log(`\n重新排序完成，共 ${reordered.length} 个神社`);

// 显示排序结果预览
console.log('\n排序结果预览（前20个）:');
reordered.slice(0, 20).forEach(s => {
  console.log(`  ${s.id}. [${s.region}] ${s.prefecture} / ${s.province} - ${s.name}`);
});

// 写入文件
fs.writeFileSync(shrinesPath, JSON.stringify(reordered, null, 2), 'utf8');
console.log('\n✅ 已保存到', shrinesPath);
