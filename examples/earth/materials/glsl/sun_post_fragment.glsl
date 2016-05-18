varying vec2 uv;
varying vec3 viewPosition;
varying vec4 projPosition;

uniform sampler2D normalMap;
uniform vec3 normalScaleOffset1;
uniform vec3 normalScaleOffset2;
uniform vec3 normalScaleOffset3;
uniform vec3 mixRatios;

uniform float refractiveRatio;
uniform vec3 tintedDensity;

uniform sampler2D hx_backbuffer;
uniform sampler2D hx_gbufferDepth;

uniform float hx_cameraFrustumRange;
uniform float hx_cameraNearPlaneDistance;
uniform mat4 hx_viewMatrix;

vec3 calculateNormal(sampler2D normalMap, vec2 uv, vec3 scaleOffset1, vec3 scaleOffset2, vec3 scaleOffset3, vec3 mixRatios, mat4 viewMatrix)
{
    vec3 normals1 = texture2D(normalMap, scaleOffset1.x * (uv + scaleOffset1.yz)).xyz * 2.0 - 1.0;
    vec3 normals2 = texture2D(normalMap, scaleOffset2.x * (uv + scaleOffset2.yz)).xyz * 2.0 - 1.0;
    vec3 normals3 = texture2D(normalMap, scaleOffset3.x * (uv + scaleOffset3.yz)).xyz * 2.0 - 1.0;
    vec3 normal = normals1 * mixRatios.x + normals2 * mixRatios.y + normals3 * mixRatios.z;
    normal = normal.xzy;
    normal.xz *= .5;
    return mat3(viewMatrix) * normalize(normal);
}

void main()
{
   vec2 screenUV = projPosition.xy / projPosition.w * .5 + .5; // more precise than interpolated
   // use the immediate background depth value for a distance estimate

   vec3 normal = calculateNormal(normalMap, uv, normalScaleOffset1, normalScaleOffset2, normalScaleOffset3, mixRatios, hx_viewMatrix);

   float depth = hx_sampleLinearDepth(hx_gbufferDepth, screenUV);
   float distance = max(hx_cameraNearPlaneDistance + depth * hx_cameraFrustumRange + viewPosition.z, 0.0);

   vec3 viewDir = normalize(viewPosition);
   vec2 samplePos = screenUV - refract(vec3(0.0, 0.0, 1.0), normal, refractiveRatio).xy * clamp(distance, 0.0, 5.0) / projPosition.w;
   vec4 color = texture2D(hx_backbuffer, samplePos);

   color.x *= exp(-distance * tintedDensity.r);
   color.y *= exp(-distance * tintedDensity.g);
   color.z *= exp(-distance * tintedDensity.b);

   gl_FragColor = color;
}