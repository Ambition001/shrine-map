#!/usr/bin/env python3
"""
一之宫神社数据爬虫脚本
从 ichinomiya-junpai.jp 抓取神社数据
"""

import re
import json
import subprocess
import time
import urllib.parse
import os

BASE_URL = "http://ichinomiya-junpai.jp"

def fetch(url):
    """使用 curl 获取页面内容"""
    result = subprocess.run(
        ['curl', '-s', '-L', '--max-time', '30', url, '-H', 'User-Agent: Mozilla/5.0'],
        capture_output=True,
        text=True
    )
    return result.stdout

def extract_links(html):
    """提取所有神社详情页链接"""
    # 匹配所有 /alllist/xxx/yyy/ 格式的详情页链接
    pattern = r'href="(/alllist/[^"]+/[^"]+/)"'
    links = re.findall(pattern, html)

    # 过滤：排除图片、只保留有效神社页面
    valid_links = []
    for link in links:
        if any(ext in link for ext in ['.jpg', '.png', '.gif']):
            continue
        valid_links.append(link)

    return sorted(list(set(valid_links)))

def extract_region(link):
    """从URL提取区域名（确保正确解码UTF-8）"""
    # 确保正确解码 URL 编码的日文字符
    decoded = urllib.parse.unquote(link, encoding='utf-8')
    parts = decoded.split('/')
    # /alllist/region/shrine/ -> parts = ['', 'alllist', 'region', 'shrine', '']
    if len(parts) >= 3:
        return parts[2]
    return ''

def geocode_shrine(name):
    """使用 Nominatim API 通过神社名获取经纬度"""
    if not name:
        return None, None

    query = f"{name} Japan"
    encoded = urllib.parse.quote(query)
    url = f"https://nominatim.openstreetmap.org/search?format=json&q={encoded}&limit=1"

    result = subprocess.run(
        ['curl', '-s', '-L', '--max-time', '10', url,
         '-H', 'User-Agent: ShrineMapScraper/1.0'],
        capture_output=True,
        text=True
    )

    try:
        data = json.loads(result.stdout)
        if data and len(data) > 0:
            return float(data[0]['lat']), float(data[0]['lon'])
    except (json.JSONDecodeError, KeyError, IndexError):
        pass

    return None, None

def extract_shrine_info(html):
    """从详情页提取神社信息"""
    info = {}

    # 神社名 - 可能被<a>标签包裹
    match = re.search(r'<td>神社名</td>\s*<td[^>]*>(?:<a[^>]*>)?([^<]+)', html)
    if match:
        info['name'] = match.group(1).strip()

    # 读音
    match = re.search(r'<td>神社名\(読み方\)</td>\s*<td[^>]*>([^<]+)', html)
    if match:
        info['reading'] = match.group(1).strip()

    # 旧国名
    match = re.search(r'<td>旧国名</td>\s*<td[^>]*>([^<]+)', html)
    if match:
        info['province'] = match.group(1).strip()

    # 祭神
    match = re.search(r'<td>祭神</td>\s*<td[^>]*>([^<]+)', html)
    if match:
        info['deity'] = match.group(1).strip()

    # 御神徳
    match = re.search(r'<td>御神徳</td>\s*<td[^>]*>([^<]+)', html)
    if match:
        info['virtue'] = match.group(1).strip()

    # 所在地 - 处理多行内容和HTML标签
    match = re.search(r'<td>所在地</td>\s*<td[^>]*>(.*?)</td>', html, re.DOTALL)
    if match:
        address = match.group(1)
        # 移除 HTML 标签
        address = re.sub(r'<[^>]+>', ' ', address)
        # 移除邮编
        address = re.sub(r'〒\d{3}-\d{4}\s*', '', address)
        # 清理多余空白
        address = re.sub(r'\s+', ' ', address).strip()
        info['address'] = address

    # 邮编
    match = re.search(r'〒(\d{3}-\d{4})', html)
    if match:
        info['zip'] = match.group(1)

    # 电话
    match = re.search(r'<td>電話番号</td>\s*<td[^>]*>([^<]+)', html)
    if match:
        info['tel'] = match.group(1).strip()

    # 都道府县
    if 'address' in info:
        pref_match = re.match(r'^(.+?[都道府県])', info['address'])
        if pref_match:
            info['prefecture'] = pref_match.group(1)

    return info

def main():
    print("开始抓取一之宫神社数据...\n")

    # 获取主列表页
    print("获取主列表页...")
    main_page = fetch(f"{BASE_URL}/alllist/")
    links = extract_links(main_page)
    print(f"找到 {len(links)} 个神社链接\n")

    shrines = []
    shrine_id = 1

    for i, link in enumerate(links, 1):
        decoded_link = urllib.parse.unquote(link)
        print(f"[{i}/{len(links)}] 获取: {decoded_link}")

        try:
            url = BASE_URL + link
            html = fetch(url)
            info = extract_shrine_info(html)

            if info.get('name'):
                # 使用神社名进行地理编码获取经纬度
                print(f"  地理编码: {info['name']}")
                lat, lng = geocode_shrine(info['name'])
                time.sleep(1)  # Nominatim 要求每秒最多 1 请求

                shrine = {
                    'id': shrine_id,
                    'name': info.get('name', ''),
                    'region': extract_region(link),
                    'reading': info.get('reading', ''),
                    'province': info.get('province', ''),
                    'prefecture': info.get('prefecture', ''),
                    'address': info.get('address', ''),
                    'zip': info.get('zip', ''),
                    'tel': info.get('tel', ''),
                    'deity': info.get('deity', ''),
                    'virtue': info.get('virtue', ''),
                    'lat': lat,
                    'lng': lng
                }
                shrines.append(shrine)
                shrine_id += 1
                if lat and lng:
                    print(f"  ✓ {info['name']} ({lat}, {lng})")
                else:
                    print(f"  ⚠ {info['name']} (经纬度待补充)")
            else:
                print(f"  ✗ 数据不完整")

            # 避免请求过快
            time.sleep(0.5)

        except Exception as e:
            print(f"  ✗ 错误: {e}")

    print(f"\n完成！共获取 {len(shrines)} 个神社数据\n")

    # 确保目录存在
    os.makedirs('src/data', exist_ok=True)

    # 保存 JSON
    output_file = 'src/data/shrines.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(shrines, f, ensure_ascii=False, indent=2)

    print(f"数据已保存到 {output_file}")

    # 也打印一份输出
    print("\n=== 前5条数据预览 ===")
    print(json.dumps(shrines[:5], ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
