import requests
from bs4 import BeautifulSoup
import pandas as pd
import re

def scrape_shrines_v4():
    url = "http://ichinomiya-junpai.jp/alllist/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    print("正在连接网站...")
    try:
        response = requests.get(url, headers=headers, timeout=15)
        response.encoding = 'utf-8'
        # 使用 BeautifulSoup 提取纯文本，并用换行符分隔标签
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # 移除脚本和样式
        for script in soup(["script", "style"]):
            script.decompose()
            
        # 获取纯文本，每块内容用换行符分开
        text = soup.get_text(separator="\n")
    except Exception as e:
        print(f"错误: {e}")
        return

    lines = [line.strip() for line in text.split('\n') if line.strip()]
    
    shrine_list = []
    
    print("正在分析文本流...")
    # 遍历所有行，寻找包含 "所在地：" 的行
    for i, line in enumerate(lines):
        if "所在地：" in line:
            # 1. 提取地址
            # 地址通常在 "所在地：" 之后
            try:
                address = line.split("所在地：")[1].split("最寄り駅")[0].strip()
                
                # 2. 提取名称
                # 名称通常在这一行 "所在地：" 之前，或者在它的上一行
                name_part = line.split("所在地：")[0].strip()
                
                # 如果当前行没名字（即只有"所在地："开头），就去上一行找
                if not name_part or name_part == "tt":
                    name_part = lines[i-1] if i > 0 else ""
                
                # 清理名称：去掉 tt, (数字), 以及可能的地区前缀
                clean_name = re.sub(r'tt\s*', '', name_part)
                clean_name = re.sub(r'\(\d+\)\s*', '', clean_name)
                # 过滤掉像 "北海道・東北" 这样的标题行
                if "・" in clean_name and len(clean_name) < 10:
                    # 如果匹配到的是地区标题，再往上找一行
                    clean_name = lines[i-1] if i > 0 else clean_name
                
                # 最终清洗
                clean_name = clean_name.replace("tt", "").strip()
                
                if clean_name and address and len(clean_name) < 30:
                    shrine_list.append({
                        "神社名": clean_name,
                        "所在地": address
                    })
                    print(f"已找到: {clean_name} -> {address}")
            except:
                continue

    # 去重并保存
    if shrine_list:
        df = pd.DataFrame(shrine_list).drop_duplicates()
        df.to_csv("shrine_data_v4.csv", index=False, encoding='utf-8-sig')
        print(f"\n成功！抓取到 {len(df)} 条神社信息。")
    else:
        print("依然未能抓取到数据，请检查网络是否能正常打开该网页。")

if __name__ == "__main__":
    scrape_shrines_v4()
