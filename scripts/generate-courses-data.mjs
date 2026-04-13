import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const coursesDir = path.join(rootDir, "docs", "courses");
const extraCatalogFile = path.join(coursesDir, "catalog.extra.json");
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

function splitList(value) {
  if (!value) return [];
  return value
    .split(/[、,，;；/|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniq(list) {
  return [...new Set((list || []).filter(Boolean))];
}

function toDateYYYYMMDD(date) {
  return date.toISOString().slice(0, 10);
}

function parseName(html, slug) {
  const fromH1 = extractFirst(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i, "");
  if (fromH1) return fromH1;
  const fromTitle = extractFirst(html, /<title>([\s\S]*?)<\/title>/i, "");
  if (!fromTitle) return slug;
  return fromTitle.split("|")[0].trim() || slug;
}

function parseTeachers(html) {
  const known = html.match(/教师[：:]\s*([^<\n]+)/i);
  if (known && known[1]) return uniq(splitList(stripTags(known[1])));

  const metaMatch = html.match(/<div[^>]*class="meta-item"[^>]*>([\s\S]*?)<\/div>/gi) || [];
  for (const block of metaMatch) {
    const text = stripTags(block);
    if (/教师/i.test(text) && /[:：]/.test(text)) {
      const v = text.split(/[:：]/).slice(1).join(":");
      return uniq(splitList(v));
    }
  }

  return [];
}

function parsePrograms(html) {
  const tagText = extractFirst(html, /<span[^>]*class="tag"[^>]*>([\s\S]*?)<\/span>/i, "");
  return uniq(splitList(tagText));
}

function parseResources(html) {
  const results = [];
  const sectionTitleRegex = /<h2[^>]*class="section-title"[^>]*>([\s\S]*?)<\/h2>/gi;
  let match = null;

  while ((match = sectionTitleRegex.exec(html)) !== null) {
    const value = stripTags(match[1]);
    if (value) results.push(value);
  }

  return uniq(results).slice(0, 6);
}

function normalizeCourse(raw) {
  const id = raw.id || raw.slug;
  const slug = raw.slug || raw.id;

  return {
    id: id || "",
    name: raw.name || slug || "未命名课程",
    slug: slug || "",
    teachers: uniq(raw.teachers || []),
    programs: uniq(raw.programs || []),
    resources: uniq(raw.resources || []),
    hasCoursePage: Boolean(raw.hasCoursePage),
    coursePage: raw.hasCoursePage ? raw.coursePage || (slug ? `/courses/${slug}/` : null) : null,
    aliases: uniq(raw.aliases || []),
    lastUpdated: raw.lastUpdated || toDateYYYYMMDD(new Date())
  };
}

function scanCoursePages() {
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

    courses.push(
      normalizeCourse({
        id: slug,
        slug,
        name: parseName(html, slug),
        teachers: parseTeachers(html),
        programs: parsePrograms(html),
        resources: parseResources(html),
        hasCoursePage: true,
        coursePage: `/courses/${slug}/`,
        aliases: [slug],
        lastUpdated: toDateYYYYMMDD(stat.mtime)
      })
    );
  }

  return courses;
}

function loadExtraCatalog() {
  if (!fs.existsSync(extraCatalogFile)) return [];

  try {
    const text = fs.readFileSync(extraCatalogFile, "utf8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => normalizeCourse(item));
  } catch (error) {
    console.warn(`Failed to parse ${path.relative(rootDir, extraCatalogFile)}: ${error.message}`);
    return [];
  }
}

function mergeCourses(autoCourses, extraCourses) {
  const byId = new Map();

  for (const course of autoCourses) {
    byId.set(course.id, course);
  }

  for (const extra of extraCourses) {
    if (!extra.id) continue;
    const exists = byId.get(extra.id);

    if (!exists) {
      byId.set(extra.id, extra);
      continue;
    }

    byId.set(
      extra.id,
      normalizeCourse({
        ...exists,
        ...extra,
        teachers: uniq([...(exists.teachers || []), ...(extra.teachers || [])]),
        programs: uniq([...(exists.programs || []), ...(extra.programs || [])]),
        resources: uniq([...(exists.resources || []), ...(extra.resources || [])]),
        aliases: uniq([...(exists.aliases || []), ...(extra.aliases || [])]),
        hasCoursePage: typeof extra.hasCoursePage === "boolean" ? extra.hasCoursePage : exists.hasCoursePage,
        coursePage: extra.coursePage !== undefined ? extra.coursePage : exists.coursePage,
        lastUpdated: extra.lastUpdated || exists.lastUpdated
      })
    );
  }

  return [...byId.values()].sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
}

function ensureExtraCatalogExists() {
  if (fs.existsSync(extraCatalogFile)) return;
  fs.writeFileSync(extraCatalogFile, "[]\n", "utf8");
}

function buildOutput(coursesList) {
  return `window.coursesList = ${JSON.stringify(coursesList, null, 2)};\n`;
}

ensureExtraCatalogExists();

const autoCourses = scanCoursePages();
const extraCourses = loadExtraCatalog();
const coursesList = mergeCourses(autoCourses, extraCourses);
const output = buildOutput(coursesList);

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, output, "utf8");

console.log(
  `Generated ${coursesList.length} courses (${autoCourses.length} auto + ${extraCourses.length} extra) -> ${path.relative(rootDir, outputFile)}`
);
