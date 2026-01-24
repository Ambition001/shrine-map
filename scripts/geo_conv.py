import pandas as pd
from geopy.geocoders import Nominatim
from geopy.extra.rate_limiter import RateLimiter
import time

def get_gps_coordinates():
    try:
        df = pd.read_csv("shrine_data_v4.csv")
    except:
        print("未找到数据文件，请先运行 Step 1 脚本。")
        return

    # 初始化地理编码器
    geolocator = Nominatim(user_agent="shrine_mapper_v4")
    # 限制访问频率（每秒 0.8 次请求），防止被封
    geocode = RateLimiter(geolocator.geocode, min_delay_seconds=1.2)

    lats = []
    lons = []

    print("\n开始查询经纬度（此过程较慢，请保持网络畅通）...")
    for i, row in df.iterrows():
        # 尝试：地址 + 名字
        query = f"{row['所在地']} {row['神社名']}"
        location = None
        
        try:
            location = geocode(query)
            if not location:
                # 备选：只搜名字
                location = geocode(row['神社名'])
        except:
            pass

        if location:
            lats.append(location.latitude)
            lons.append(location.longitude)
            print(f"[{i+1}/{len(df)}] 成功: {row['神社名']} ({location.latitude}, {location.longitude})")
        else:
            lats.append(None)
            lons.append(None)
            print(f"[{i+1}/{len(df)}] 失败: {row['神社名']}")

    df['latitude'] = lats
    df['longitude'] = lons
    
    df.to_csv("shrine_with_gps_final.csv", index=False, encoding='utf-8-sig')
    print("\n任务完成！最终文件: shrine_with_gps_final.csv")

if __name__ == "__main__":
    get_gps_coordinates()
