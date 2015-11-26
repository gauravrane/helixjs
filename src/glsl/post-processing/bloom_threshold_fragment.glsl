varying vec2 uv;

uniform sampler2D hx_frontbuffer;

uniform float threshold;

void main()
{
        vec4 color = texture2D(hx_frontbuffer, uv);
        float originalLuminance = .05 + hx_luminance(color);
        float targetLuminance = max(originalLuminance - threshold, 0.0);
        gl_FragColor = color * targetLuminance / originalLuminance;
}
