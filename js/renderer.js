import { SESSION_LOCATIONS } from "./data.js";

const WORLD_WIDTH = 1448;
const WORLD_HEIGHT = 1086;

function easeInOut(value) {
  return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
}

export class ChurchRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.background = new Image();
    this.people = new Image();
    this.ready = false;
    this.location = "nave";
    this.visitorSprite = 1;
    this.visitorVisible = false;
    this.walkStart = 0;
    this.walkDuration = 2600;
    this.sundayCrowd = [];
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.resize = this.resize.bind(this);
    window.addEventListener("resize", this.resize);
  }

  async load() {
    await Promise.all([
      this.loadImage(this.background, "assets/church.png"),
      this.loadImage(this.people, "assets/people.png")
    ]);
    this.ready = true;
    this.resize();
    requestAnimationFrame((time) => this.draw(time));
  }

  loadImage(image, source) {
    return new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = source;
    });
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.round(rect.height * ratio));
  }

  beginVisit(location, sprite) {
    this.location = location;
    this.visitorSprite = sprite;
    this.visitorVisible = true;
    this.sundayCrowd = [];
    this.walkStart = performance.now();
  }

  clearVisitor() {
    this.visitorVisible = false;
  }

  showSundayCrowd(people) {
    this.visitorVisible = false;
    this.sundayCrowd = people.slice(0, 72);
  }

  drawSprite(index, x, y, width = 76, height = 128, alpha = 1) {
    const column = index % 7;
    const row = Math.floor(index / 7);
    const sourceX = Math.round(column * this.people.width / 7);
    const sourceRight = Math.round((column + 1) * this.people.width / 7);
    const sourceY = Math.round(row * this.people.height / 6);
    const sourceBottom = Math.round((row + 1) * this.people.height / 6);
    this.context.save();
    this.context.globalAlpha = alpha;
    this.context.drawImage(
      this.people,
      sourceX, sourceY, sourceRight - sourceX, sourceBottom - sourceY,
      x - width / 2, y - height, width, height
    );
    this.context.restore();
  }

  routePosition(route, progress) {
    if (!Array.isArray(route) || route.length === 0) return { x: 724, y: 995 };
    progress = Math.max(0, Math.min(1, Number(progress) || 0));
    if (progress >= 1) return route[route.length - 1];
    const segmentProgress = progress * (route.length - 1);
    const segment = Math.floor(segmentProgress);
    const local = easeInOut(segmentProgress - segment);
    const from = route[segment];
    const to = route[Math.min(route.length - 1, segment + 1)];
    return {
      x: from.x + (to.x - from.x) * local,
      y: from.y + (to.y - from.y) * local
    };
  }

  drawCrowd() {
    const seats = [];
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 10; col += 1) {
        const leftSide = col < 5;
        seats.push({
          x: leftSide ? 465 + (col % 5) * 34 : 820 + (col - 5) * 34,
          y: 490 + row * 60
        });
      }
    }
    this.sundayCrowd.forEach((person, index) => {
      const seat = seats[index % seats.length];
      this.drawSprite(person.sprite, seat.x, seat.y, 35, 59, 0.96);
    });
    this.drawSprite(0, 720, 310, 72, 122);
  }

  draw(time) {
    if (!this.ready) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
    const offsetX = (width - WORLD_WIDTH * scale) / 2;
    const offsetY = (height - WORLD_HEIGHT * scale) / 2;
    this.context.clearRect(0, 0, width, height);
    this.context.save();
    this.context.translate(offsetX, offsetY);
    this.context.scale(scale, scale);
    this.context.drawImage(this.background, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    if (this.sundayCrowd.length) {
      this.drawCrowd();
    } else if (this.visitorVisible) {
      const location = SESSION_LOCATIONS[this.location];
      const progress = this.reducedMotion ? 1 : Math.max(0, Math.min(1, (time - this.walkStart) / this.walkDuration));
      const visitor = this.routePosition(location.route, progress);
      const bob = progress < 1 ? Math.sin(time / 90) * 2 : 0;
      this.drawSprite(0, location.priest.x, location.priest.y, 72, 122);
      this.drawSprite(this.visitorSprite, visitor.x, visitor.y + bob, 76, 128);
      if (progress < 1) {
        this.context.fillStyle = "rgba(255, 226, 157, .72)";
        this.context.beginPath();
        this.context.arc(visitor.x, visitor.y + 8, 3, 0, Math.PI * 2);
        this.context.fill();
      }
    } else {
      this.drawSprite(0, 646, 670, 72, 122);
    }
    this.context.restore();
    requestAnimationFrame((nextTime) => this.draw(nextTime));
  }
}
