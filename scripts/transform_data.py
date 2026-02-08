import pandas as pd
import sys
import os
import argparse

def json_to_excel(input_file, output_file):
    """
    将 JSON 文件转换为 Excel (.xlsx)
    """
    try:
        # 读取 JSON 文件
        # encoding='utf-8' 确保日文能正确读取
        df = pd.read_json(input_file, encoding='utf-8')
        
        # 写入 Excel 文件
        # index=False 表示不把 pandas 的行索引写入 Excel
        df.to_excel(output_file, index=False, engine='openpyxl')
        
        print(f"✅ 成功转换: {input_file} -> {output_file}")
        
    except Exception as e:
        print(f"❌ 转换失败: {e}")

def excel_to_json(input_file, output_file):
    """
    将 Excel 文件转换为 JSON
    """
    try:
        # 读取 Excel 文件
        df = pd.read_excel(input_file, engine='openpyxl')
        
        # 写入 JSON 文件
        # orient='records' 输出格式为 [{"col":val}, ...] (与你提供的格式一致)
        # force_ascii=False 确保日文不会变成 \uXXXX 乱码
        # indent=2 为了让输出的 JSON 有缩进，易于阅读
        df.to_json(output_file, orient='records', force_ascii=False, indent=2)
        
        print(f"✅ 成功转换: {input_file} -> {output_file}")
        
    except Exception as e:
        print(f"❌ 转换失败: {e}")

def main():
    # 设置命令行参数解析
    parser = argparse.ArgumentParser(description="JSON 和 Excel 互转工具")
    parser.add_argument('input_file', help="输入文件路径 (例如: shrines.json 或 data.xlsx)")
    parser.add_argument('output_file', nargs='?', help="输出文件路径 (可选，如果不填则自动生成)")

    args = parser.parse_args()

    input_path = args.input_file
    file_name, file_ext = os.path.splitext(input_path)
    file_ext = file_ext.lower()

    # 自动判断输出文件名（如果没有指定）
    if args.output_file:
        output_path = args.output_file
    else:
        if file_ext == '.json':
            output_path = file_name + '.xlsx'
        elif file_ext in ['.xlsx', '.xls']:
            output_path = file_name + '.json'
        else:
            print("❌ 无法识别的文件扩展名。请使用 .json 或 .xlsx 文件。")
            return

    # 根据输入文件扩展名执行相应的转换
    if file_ext == '.json':
        print(f"正在将 JSON 转换为 Excel...")
        json_to_excel(input_path, output_path)
    elif file_ext in ['.xlsx', '.xls']:
        print(f"正在将 Excel 转换为 JSON...")
        excel_to_json(input_path, output_path)
    else:
        print("❌ 不支持的文件格式。")

if __name__ == "__main__":
    main()