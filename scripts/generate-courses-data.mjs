import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const coursesDir = path.join(rootDir, "docs", "courses");
const outputFile = path.join(rootDir, "docs", "assets", "js", "courses-data.js");

function stripTags(input = "") {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirst(html, regex, fallback = "") {
  const match = html.match(regex);
  if (!match || !match[1]) return fallback;
  return stripTags(match[1]);
}

function toDateYYYYMMDD(date) {
  return date.toISOString().slice(0, 10);
}

function parseTeacher(html) {
  const teacherMatch = html.match(/教师[：:]\s*([^<\n]+)/i);
  if (!teacherMatch) return "待补充";
  return stripTags(teacherMatch[1]) || "待补充";
}

function parseTags(html) {
  const tags = [];
  const sectionTitleRegex = /<h2[^>]*class="section-title"[^>]*>([\s\S]*?)<\/h2>/gi;
  let match = null;

  while ((match = sectionTitleRegex.exec(html)) !== null) {
    const value = stripTags(match[1]);
    if (value) tags.push(value);
  }

  return [...new Set(tags)].slice(0, 4);
}

function parseLevel(html) {
  const level = extractFirst(html, /<span[^>]*class="tag"[^>]*>([\s\S]*?)<\/span>/i, "");
  return level || "待补充";
}

function parseName(html, slug) {
  const fromH1 = extractFirst(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i, "");
  if (fromH1) return fromH1;
  const fromTitle = extractFirst(html, /<title>([\s\S]*?)<\/title>/i, "");
  if (!fromTitle) return slug;
  return fromTitle.split("|")[0].trim() || slug;
}

function scanCourses() {
  if (!fs.existsSync(coursesDir)) return [];

  const entries = fs.readdirSync(coursesDir, { withFileTypes: true });
  const courses = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const slug = entry.name;
    const courseIndex = path.join(coursesDir, slug, "index.html");
    if (!fs.existsSync(courseIndex)) continue;

    const html = fs.readFileSync(courseIndex, "utf8");
    const stat = fs.statSync(courseIndex);

    courses.push({
      name: parseName(html, slug),
      slug,
      level: parseLevel(html),
      teacher: parseTeacher(html),
      tags: parseTags(html),
      lastUpdated: toDateYYYYMMDD(stat.mtime)
    });
  }

  return courses.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
}

function buildOutput(coursesList) {
  return `window.coursesList = ${JSON.stringify(coursesList, null, 2)};\n`;
}

const coursesList = scanCourses();
const output = buildOutput(coursesList);

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, output, "utf8");

console.log(`Generated ${coursesList.length} courses -> ${path.relative(rootDir, outputFile)}`);
