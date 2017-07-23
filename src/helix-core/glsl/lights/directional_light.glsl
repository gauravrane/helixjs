struct HX_DirectionalLight
{
    vec3 color;
    vec3 direction; // in view space?

    mat4 shadowMapMatrices[4];
    vec4 splitDistances;
    float depthBias;
    float maxShadowDistance;    // = light.splitDistances[light.numCascades - 1]
};

void hx_calculateLight(HX_DirectionalLight light, HX_GeometryData geometry, vec3 viewVector, vec3 viewPosition, vec3 normalSpecularReflectance, out vec3 diffuse, out vec3 specular)
{
	hx_brdf(geometry, light.direction, viewVector, viewPosition, light.color, normalSpecularReflectance, diffuse, specular);
}

mat4 hx_getShadowMatrix(HX_DirectionalLight light, vec3 viewPos)
{
    #if HX_NUM_SHADOW_CASCADES > 1
        // not very efficient :(
        for (int i = 0; i < HX_NUM_SHADOW_CASCADES - 1; ++i) {
            if (viewPos.z < light.splitDistances[i])
                return light.shadowMapMatrices[i];
        }
        return light.shadowMapMatrices[HX_NUM_SHADOW_CASCADES - 1];
    #else
        return light.shadowMapMatrices[0];
    #endif
}

float hx_calculateShadows(HX_DirectionalLight light, sampler2D shadowMap, vec3 viewPos)
{
    mat4 shadowMatrix = hx_getShadowMatrix(light, viewPos);
    float shadow = hx_dir_readShadow(shadowMap, viewPos, shadowMatrix, light.depthBias);
    // this makes sure that anything beyond the last cascade is unshadowed
    return max(shadow, float(viewPos.z > light.maxShadowDistance));
}