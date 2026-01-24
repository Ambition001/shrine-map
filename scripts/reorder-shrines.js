/**
 * 按地区顺序重新排列神社ID
 * 顺序：北海道・東北 → 関東 → 甲信越 → 東海 → 近畿 → 中国 → 四国 → 九州・沖縄
 */

const fs = require('fs');
const path = require('path');

// 地区顺序
const REGION_ORDER = [
  '北海道・東北',
  '関東',
  '甲信越',
  '東海',
  '近畿',
  '中国',
  '四国',
  '九州・沖縄'
];

// 读取数据
const shrinesPath = path.join(__dirname, '../src/data/shrines.json');
const shrines = JSON.parse(fs.readFileSync(shrinesPath, 'utf8'));

console.log(`读取到 ${shrines.length} 个神社`);

// 按地区分组
const byRegion = {};
for (const shrine of shrines) {
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

// 按顺序重新编号
const reordered = [];
let newId = 1;

for (const region of REGION_ORDER) {
  const regionShrines = byRegion[region] || [];
  for (const shrine of regionShrines) {
    reordered.push({
      ...shrine,
      id: newId++
    });
  }
}

console.log(`\n重新排序完成，共 ${reordered.length} 个神社`);

// 写入文件
fs.writeFileSync(shrinesPath, JSON.stringify(reordered, null, 2), 'utf8');
console.log('✅ 已保存到', shrinesPath);
