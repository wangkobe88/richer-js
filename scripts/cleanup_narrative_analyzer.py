#!/usr/bin/env python3
"""
清理 NarrativeAnalyzer.mjs 中已移到其他模块的方法
"""

import re

# 要删除的方法列表（方法名）
METHODS_TO_DELETE = [
    'performPreCheck',
    '_fetchAllDataViaClassifier',
    '_fetchDataSequentially',
    'fetchTokenData',
    'extractInfo',
    '_checkBinanceRelated',
    '_hasValidDataForAnalysis',
    '_collectAllAccountsWithFullInfo',
    '_getFullAccountInfo',
    '_hasIndependentWebsite',
    '_shouldUseAccountCommunityAnalysis',
    '_analyzeAccountCommunityToken',
    '_analyzeMemeTokenTwoStage',
    'detectLanguage',
    'standardizeTranslatedNames',
    '_cleanDataForDB',
    'formatResult',
    '_parseStage1Response',
    '_parseEventResponse',
    '_parseJSONResponse',
    '_callLLMAPI',
    '_saveStage1Data',
    '_saveStage2Data',
    '_analyzeImagesForHighInfluenceAccount',
]

# 也要删除文件末尾的辅助函数（类外函数）
FUNCTIONS_TO_DELETE = [
    'getTikTokInfluenceLevel',
    'getTikTokInfluenceDescription',
]

def read_file(file_path):
    """读取文件内容"""
    with open(file_path, 'r', encoding='utf-8') as f:
        return f.read()

def write_file(file_path, content):
    """写入文件内容"""
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

def find_method_range(content, method_name):
    """
    查找方法的起始和结束位置
    返回 (start_line, end_line) 或 None
    """
    lines = content.split('\n')

    # 查找方法定义行（支持 static async methodName、static methodName、async methodName）
    method_pattern = re.compile(r'^\s*static(?:\s+async)?\s+' + re.escape(method_name) + r'\s*\(')

    start_line = None
    end_line = None

    for i, line in enumerate(lines):
        if start_line is None:
            if method_pattern.match(line):
                start_line = i
        else:
            # 找到方法开始后，继续查找结束位置
            # 方法结束是：下一个方法定义、类定义结束、或文件结束
            if re.match(r'^\s*(static|async|\}|function)', line) and line.strip() not in ['}', '']:
                # 找到下一个方法/函数定义
                end_line = i
                break
            elif i == len(lines) - 1:
                # 文件结束
                end_line = i + 1
                break

    if start_line is not None and end_line is not None:
        return (start_line, end_line)
    return None

def find_function_range(content, function_name):
    """
    查找文件末尾的辅助函数（类外函数）
    返回 (start_line, end_line) 或 None
    """
    lines = content.split('\n')

    # 查找函数定义行
    function_pattern = re.compile(r'^function\s+' + re.escape(function_name) + r'\s*\(')

    start_line = None
    end_line = None

    for i, line in enumerate(lines):
        if start_line is None:
            if function_pattern.match(line):
                start_line = i
        else:
            # 找到函数开始后，查找结束位置
            if re.match(r'^\s*(function|\})', line) and line.strip() not in ['}', '']:
                # 找到下一个函数定义
                end_line = i
                break
            elif i == len(lines) - 1:
                # 文件结束
                end_line = i + 1
                break

    if start_line is not None and end_line is not None:
        return (start_line, end_line)
    return None

def cleanup_file(file_path):
    """清理文件，删除指定的方法和函数"""
    content = read_file(file_path)
    lines = content.split('\n')

    # 收集要删除的行范围
    ranges_to_delete = []

    # 查找类内方法
    for method_name in METHODS_TO_DELETE:
        range_info = find_method_range(content, method_name)
        if range_info:
            print(f"找到方法: {method_name} (行 {range_info[0]+1} - {range_info[1]})")
            ranges_to_delete.append(range_info)

    # 查找类外函数
    for function_name in FUNCTIONS_TO_DELETE:
        range_info = find_function_range(content, function_name)
        if range_info:
            print(f"找到函数: {function_name} (行 {range_info[0]+1} - {range_info[1]})")
            ranges_to_delete.append(range_info)

    # 按起始行排序，从后往前删除（避免行号变化）
    ranges_to_delete.sort(key=lambda x: x[0], reverse=True)

    # 删除指定行
    for start, end in ranges_to_delete:
        # 删除从start到end的行（包括前后的空行）
        # 向前查找空行
        while start > 0 and lines[start - 1].strip() == '':
            start -= 1
        # 向后查找空行
        while end < len(lines) and lines[end].strip() == '':
            end += 1

        del lines[start:end]

    # 写回文件
    new_content = '\n'.join(lines)
    write_file(file_path, new_content)

    print(f"\n清理完成！从 {len(content.split(chr(10)))} 行减少到 {len(lines)} 行")

if __name__ == '__main__':
    file_path = '/Users/nobody1/Desktop/Codes/richer-js/src/narrative/analyzer/NarrativeAnalyzer.mjs'
    cleanup_file(file_path)
