precision mediump float;

/** @resolution */
uniform vec2 u_resolution;
/** @time */
uniform float u_time;
/** @label Light color @color @default #ffffff */
uniform vec3 u_light;
/** @label Reasoning strength @range 0, 1 @default 0.67 */
uniform float u_strength;
/** @label Reduce motion @range 0, 1 @default 0 */
uniform float u_reduceMotion;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  // Work in track-height units so the lights remain the same size at any DPI.
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float radius = 0.5;
  vec2 nearest = vec2(clamp(p.x, radius, aspect - radius), radius);
  float clipAlpha = 1.0 - smoothstep(0.48, 0.5, length(p - nearest));
  float light = 0.0;
  // Increase density as well as total count as the active track grows.
  float level = floor(clamp(u_strength, 0.0, 1.0) * 6.0 + 0.5);
  float count = step(0.5, level) * (level + 1.0) * (level + 2.0) * 0.5;
  float duration = 4.0;
  if (level > 1.5) duration = 3.0;
  if (level > 2.5) duration = 2.2;
  if (level > 3.5) duration = 1.6;
  if (level > 4.5) duration = 1.1;
  if (level > 5.5) duration = 0.75;
  float speed = 1.0 / duration;
  for (int i = 0; i < 28; i++) {
    float seed = float(i);
    float visible = step(seed + 0.5, count);
    float t = u_time * speed * (1.0 + 0.04 * mod(seed, 3.0));
    float x = fract(seed * 0.618034 - t) * aspect;
    float y = 0.5 + sin(seed * 2.41 + u_time * 0.7) * 0.28;
    float size = 0.045 + 0.018 * mod(seed, 3.0);
    float dotAlpha = 1.0 - smoothstep(size * 0.4, size, distance(p, vec2(x, y)));
    light += visible * dotAlpha * (0.35 + 0.20 * sin(seed + u_time * 1.1));
  }
  float alpha = min(light, 0.55) * clipAlpha * (1.0 - u_reduceMotion);
  gl_FragColor = vec4(u_light * alpha, alpha);
}
