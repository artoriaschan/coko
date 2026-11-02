precision mediump float;
/** @resolution */
uniform vec2 u_resolution;
/** @label Row title content */
uniform sampler2D u_content;
/** @label Fade left edge @range 0, 1 @default 0 */
uniform float u_left;
/** @label Fade right edge @range 0, 1 @default 0 */
uniform float u_right;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  // Title viewport is 20 logical pixels tall; edge fades occupy 12 pixels.
  float x = gl_FragCoord.x * 20.0 / u_resolution.y;
  float width = u_resolution.x * 20.0 / u_resolution.y;
  float left = mix(1.0, smoothstep(0.0, 12.0, x), u_left);
  float right = mix(1.0, smoothstep(0.0, 12.0, width - x), u_right);
  gl_FragColor = texture2D(u_content, uv) * left * right;
}
