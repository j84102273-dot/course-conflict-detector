/**
 * 课表冲突检测器 主逻辑
 * 1. 读取用户粘贴的课表文本
 * 2. 调用 DeepSeek API 解析为结构化 JSON
 * 3. 将课程渲染到周课表网格（支持跨时段）
 * 4. 检测同一天时间冲突并标红
 */

// ==== 常量 & 工具函数 ==== //
var API_URL = 'https://api.deepseek.com/v1/chat/completions';
var MODEL = 'deepseek-coder';

// API Key 硬编码，用户无需手动输入
var API_KEY = 'YOUR_DEEPSEEK_API_KEY';

/** 将时间统一为 HH:MM */
function normalizeTime(str) {
    var parts = str.split(':');
    return parts[0].padStart(2, '0') + ':' + parts[1].padStart(2, '0');
}

/** 判断两个闭区间时间段是否相交 */
function timeOverlap(aStart, aEnd, bStart, bEnd) {
    return !(aEnd <= bStart || bEnd <= aStart);
}

/** 调用 DeepSeek 将自由文本转为结构化课程数组 */
async function parseSchedule(rawText) {
    var systemPrompt = '你是一个帮助学生把课表文本解析为结构化JSON的助手。' +
        '要求返回一个JSON数组，每个元素包含：name(课程名)、day(整数数组,1=周一..7=周日)、start(HH:MM)、end(HH:MM)、location(可选)。' +
        '如果课程跨多天(如"周二、周四")，day数组列出对应数字。只返回JSON，不要解释。';

    var userPrompt = '下面是课表文本，请解析为上述JSON格式。\n\n"""\n' + rawText + '\n"""';

    var body = {
        model: MODEL,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        temperature: 0,
        max_tokens: 2048
    };

    var resp = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + API_KEY
        },
        body: JSON.stringify(body)
    });

    if (!resp.ok) {
        var txt = await resp.text();
        throw new Error('DeepSeek请求失败 ' + resp.status + ': ' + txt);
    }
    var data = await resp.json();
    var content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
    if (!content) throw new Error('未能获取AI返回的JSON');
    try {
        // 去掉可能的 ```json 包裹
        var clean = content.replace(/```json\n?|```/g, '').trim();
        return JSON.parse(clean);
    } catch (e) {
        console.error('AI JSON解析错误', e, content);
        throw new Error('AI返回的JSON解析失败');
    }
}

/** 渲染课表网格 */
function renderSchedule(courses) {
    var grid = document.getElementById('scheduleGrid');
    var times = [];
    for (var h = 8; h <= 20; h++) times.push(String(h).padStart(2, '0') + ':00');
    grid.innerHTML = '';

    // 时间列
    var timeHeader = document.createElement('div');
    timeHeader.className = 'cell time-header';
    timeHeader.textContent = '时间';
    grid.appendChild(timeHeader);
    times.forEach(function(t) {
        var cell = document.createElement('div');
        cell.className = 'cell';
        cell.textContent = t;
        grid.appendChild(cell);
    });

    // 7天列
    var dayNames = ['周一','周二','周三','周四','周五','周六','周日'];
    dayNames.forEach(function(dn, idx) {
        var header = document.createElement('div');
        header.className = 'cell header';
        header.textContent = dn;
        grid.appendChild(header);
        times.forEach(function(t) {
            var slot = document.createElement('div');
            slot.className = 'slot';
            slot.dataset.day = (idx + 1).toString();
            slot.dataset.time = t;
            grid.appendChild(slot);
        });
    });

    // 填充课程（追加到网格，通过 gridColumn / gridRow 定位）
    courses.forEach(function(course) {
        var name = course.name, day = course.day, start = course.start, end = course.end, location = course.location;
        var startIdx = times.indexOf(start);
        var endIdx = times.indexOf(end);
        if (startIdx === -1 || endIdx === -1) return;
        var span = endIdx - startIdx;
        day.forEach(function(d) {
            var courseDiv = document.createElement('div');
            courseDiv.className = 'slot course';
            courseDiv.dataset.day = d.toString();
            courseDiv.dataset.start = start;
            courseDiv.dataset.end = end;
            courseDiv.style.gridColumn = (2 + d).toString();
            courseDiv.style.gridRow = 'span ' + span;
            var html = '<div class="course-name">' + name + '</div>';
            if (location) html += '<div class="course-room">' + location + '</div>';
            courseDiv.innerHTML = html;
            grid.appendChild(courseDiv);
        });
    });
}

/** 检测冲突 */
function detectConflicts(courses) {
    var conflicts = [];
    var byDay = {};
    courses.forEach(function(c) {
        c.day.forEach(function(d) {
            if (!byDay[d]) byDay[d] = [];
            byDay[d].push(c);
        });
    });
    Object.keys(byDay).forEach(function(day) {
        var list = byDay[day];
        for (var i = 0; i < list.length; i++) {
            for (var j = i + 1; j < list.length; j++) {
                if (timeOverlap(list[i].start, list[i].end, list[j].start, list[j].end)) {
                    conflicts.push({ day: Number(day), a: list[i], b: list[j] });
                }
            }
        }
    });
    return conflicts;
}

/** 标记冲突格子 */
function markConflicts(conflicts) {
    var grid = document.getElementById('scheduleGrid');
    grid.querySelectorAll('.course').forEach(function(el) { el.classList.remove('conflict'); });
    conflicts.forEach(function(conf) {
        [conf.a, conf.b].forEach(function(course) {
            var sel = '.course[data-day="' + conf.day + '"][data-start="' + course.start + '"][data-end="' + course.end + '"]';
            var el = grid.querySelector(sel);
            if (el) el.classList.add('conflict');
        });
    });
}

/** UI 绑定 */
function bindUI() {
    var rawInput = document.getElementById('courseInput');
    var parseBtn = document.getElementById('parseBtn');
    var detectBtn = document.getElementById('detectBtn');
    var clearBtn = document.getElementById('clearBtn');
    var statusDiv = document.getElementById('parseStatus');
    var conflictDiv = document.getElementById('conflictResult');
    var demoBtn = document.getElementById('demoBtn');

    // 解析课表
    parseBtn.addEventListener('click', async function() {
        var raw = rawInput.value.trim();
        if (!raw) { alert('请先粘贴课表文本'); return; }
        statusDiv.textContent = '🟣 正在解析，请稍候…';
        statusDiv.className = 'status-area loading';
        try {
            var courses = await parseSchedule(raw);
            renderSchedule(courses);
            detectBtn.disabled = false;
            window.__parsedCourses = courses;
            // 解析完自动检测冲突
            var conflicts = detectConflicts(courses);
            if (conflicts.length === 0) {
                conflictDiv.textContent = '🎉 没有检测到冲突';
                conflictDiv.className = 'conflict-area no-conflict';
            } else {
                conflictDiv.textContent = '⚠️ 检测到 ' + conflicts.length + ' 处冲突，请查看红色课程';
                conflictDiv.className = 'conflict-area has-conflict';
                markConflicts(conflicts);
            }
            statusDiv.textContent = '✅ 解析完成，共 ' + courses.length + ' 门课程';
            statusDiv.className = 'status-area success';
        } catch (e) {
            console.error(e);
            statusDiv.textContent = '❌ 解析失败：' + e.message;
            statusDiv.className = 'status-area error';
        }
    });

    // 手动检测冲突按钮
    detectBtn.addEventListener('click', function() {
        var courses = window.__parsedCourses || [];
        var conflicts = detectConflicts(courses);
        if (conflicts.length === 0) {
            conflictDiv.textContent = '🎉 没有检测到冲突';
            conflictDiv.className = 'conflict-area no-conflict';
        } else {
            conflictDiv.textContent = '⚠️ 检测到 ' + conflicts.length + ' 处冲突，请查看红色课程';
            conflictDiv.className = 'conflict-area has-conflict';
            markConflicts(conflicts);
        }
    });

    // 清空
    clearBtn.addEventListener('click', function() {
        rawInput.value = '';
        document.getElementById('scheduleGrid').innerHTML = '';
        statusDiv.textContent = '';
        conflictDiv.textContent = '';
        detectBtn.disabled = true;
        window.__parsedCourses = [];
    });

    // 示例数据
    demoBtn.addEventListener('click', function() {
        rawInput.value = '高等数学 周一 08:00-09:40 A教101\n线性代数 周二 10:00-11:40 B教203\n大学英语 周三 14:00-15:40 C教305\n程序设计 周一 09:00-10:30 D教401';
    });
}

window.addEventListener('DOMContentLoaded', bindUI);