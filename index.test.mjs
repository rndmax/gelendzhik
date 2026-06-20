import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

function loadGuideApi() {
  const scripts = [...html.matchAll(/<script(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi)];
  const mainScript = scripts.map((match) => match[1]).find((script) => script.includes("const places"));

  assert.ok(mainScript, "expected an inline script that defines const places");

  const elements = new Map();
  const documentListeners = new Map();
  const windowScrollCalls = [];
  const document = {
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    createElement(tagName) {
      return {
        tagName,
        children: [],
        className: "",
        dataset: {},
        hidden: false,
        innerHTML: "",
        textContent: "",
        attributes: {},
        eventListeners: {},
        type: "",
        getBoundingClientRect() {
          return {
            height: 0,
            top: 0,
          };
        },
        append(...nodes) {
          this.children.push(...nodes);
        },
        appendChild(node) {
          this.children.push(node);
        },
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        addEventListener(type, listener) {
          this.eventListeners[type] = listener;
        },
        click() {
          this.eventListeners.click?.({ target: this });
        },
      };
    },
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, this.createElement("div"));
      }
      return elements.get(id);
    },
    querySelector(selector) {
      return this.getElementById(selector.replace(/^#/, ""));
    },
    querySelectorAll() {
      return [];
    },
  };

  const sandbox = {
    document,
    window: {
      scrollY: 0,
      scrollTo(options) {
        windowScrollCalls.push(options);
      },
    },
    console,
  };

  sandbox.window.document = document;
  vm.runInNewContext(mainScript, sandbox);

  return {
    ...sandbox.window.GelendzhikGuide,
    testHarness: {
      document,
      documentListeners,
      elements,
      window: sandbox.window,
      windowScrollCalls,
    },
  };
}

test("page has SEO metadata and semantic landmarks", () => {
  assert.match(html, /<title>Гид по Геленджику<\/title>/);
  assert.match(html, /<meta[\s\S]*?name="description"/);
  assert.match(html, /<meta property="og:title"/);
  assert.match(html, /<script type="application\/ld\+json" id="jsonLd">/);
  assert.match(html, /<header[\s>]/);
  assert.match(html, /<main[\s>]/);
  assert.match(html, /<footer[\s>]/);
  assert.equal([...html.matchAll(/<h1[\s>]/g)].length, 1);
});

test("hero introduces Max and shows contact links with app icons", () => {
  assert.match(html, /Привет, меня зовут Макс Коревский\./);
  assert.match(html, /Я посетил более 20 стран/);
  assert.match(html, /Геленджик — одно из моих любимых мест\s+на нашей планете/);
  assert.match(html, /С удовольствием поделюсь классными местами/);
  assert.doesNotMatch(
    html,
    /<p class="hero__subtitle">\s*Личная подборка мест: природа, рестораны, кофейни, пляжи, детские места, спорт и полезные точки\.\s*<\/p>/,
  );
  assert.match(
    html,
    /href="https:\/\/t\.me\/rndmax"[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"[\s\S]*data-contact="telegram"[\s\S]*?>[\s\S]*?<img[\s\S]*src="assets\/telegram-icon\.svg"[\s\S]*?Telegram/,
  );
  assert.match(
    html,
    /href="https:\/\/max\.ru\/u\/f9LHodD0cOI0lvYzQ9ThTrBjnWMKufaDsUgf2ce-Eeaq1_Uko599Mn9bR_c"[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"[\s\S]*data-contact="max"[\s\S]*?>[\s\S]*?<img[\s\S]*src="assets\/max-icon\.ico"[\s\S]*?Max/,
  );
  assert.doesNotMatch(html, /aria-disabled="true"/);
  assert.doesNotMatch(html, /Контакты для связи/);
});

test("guide data keeps the requested categories and required fields", () => {
  const guide = loadGuideApi();

  assert.deepEqual(
    [...guide.categories].map((category) => category.id),
    ["nature", "restaurants", "coffee", "beaches", "parks", "kids", "sport", "other"],
  );
  assert.equal(guide.places.length, 55);

  for (const place of guide.places) {
    assert.ok(place.id, `${place.title} should have an id`);
    assert.ok(place.title, `${place.id} should have a title`);
    assert.ok(place.description, `${place.id} should have a description`);
    assert.ok(place.category, `${place.id} should have a category`);
    assert.ok(place.categoryLabel, `${place.id} should have a category label`);
    assert.equal(typeof place.priority, "number", `${place.id} should have numeric priority`);
  }
});

test("filters combine category, title, description, category label, and tags", () => {
  const guide = loadGuideApi();

  assert.deepEqual(
    [...guide.filterPlaces({ category: "coffee", query: "лимонный тарт" })].map((place) => place.title),
    ["Кекс"],
  );
  assert.deepEqual(
    [...guide.filterPlaces({ category: "nature", query: "водопады" })].map((place) => place.title),
    ["Водопады на реке Жане"],
  );
  assert.equal(guide.filterPlaces({ category: "restaurants", query: "лимонный тарт" }).length, 0);
});

test("grouping preserves category order and priority sorting", () => {
  const guide = loadGuideApi();
  const groups = guide.groupPlaces(guide.places);

  assert.equal(groups[0].category.id, "nature");
  assert.equal(groups[0].places[0].title, "Водопады на реке Жане");
  assert.equal(groups.at(-1).category.id, "other");
  assert.equal(groups.at(-1).places.at(-1).title, "Центральный рынок");
});

test("only supplied map URLs are exposed", () => {
  const guide = loadGuideApi();
  const mappedPlaces = guide.places.filter((place) => place.mapUrl);
  const mapUrlByTitle = new Map(mappedPlaces.map((place) => [place.title, place.mapUrl]));

  assert.ok(mappedPlaces.length > 4);
  assert.ok(mappedPlaces.every((place) => place.mapUrl.startsWith("https://yandex.com/maps/")));
  assert.ok(mappedPlaces.some((place) => place.title === "Голубая бездна"));
  assert.ok(mappedPlaces.some((place) => place.title === "Баскетбольная площадка в Южном районе"));
  assert.ok(mapUrlByTitle.has("Джанхот"));
  assert.ok(mapUrlByTitle.has("Центральный парк культуры и отдыха"));
  assert.ok(mapUrlByTitle.has("Метрополь"));
  assert.ok(mapUrlByTitle.has("Центральные песчаные пляжи"));
});

test("map action is compact and filter chips show horizontal scroll affordance", () => {
  assert.match(html, /\.map-link\s*{[\s\S]*?min-height:\s*32px;/);
  assert.match(html, /\.map-link\s*{[\s\S]*?padding:\s*0 10px;/);
  assert.doesNotMatch(html, /\.map-link\s*{[\s\S]*?background:\s*var\(--pine\);/);
  assert.match(html, /\.chip-row-wrap::after/);
  assert.match(html, /Прокрутите категории/);
});

test("category filter click resets viewport to the beginning of results", () => {
  const guide = loadGuideApi();
  const { document, documentListeners, elements, window, windowScrollCalls } = guide.testHarness;
  const content = document.getElementById("content");
  const controls = document.getElementById("controls");

  window.scrollY = 640;
  content.getBoundingClientRect = () => ({ top: -120, height: 1200 });
  controls.getBoundingClientRect = () => ({ top: 0, height: 92 });

  documentListeners.get("DOMContentLoaded")();
  const filterButtons = elements.get("categoryFilters").children;
  const coffeeButton = filterButtons.find((button) => button.dataset.category === "coffee");

  assert.ok(coffeeButton, "expected coffee filter chip to be rendered");
  coffeeButton.click();

  assert.equal(windowScrollCalls.at(-1).top, 412);
  assert.equal(windowScrollCalls.at(-1).behavior, "smooth");
});
