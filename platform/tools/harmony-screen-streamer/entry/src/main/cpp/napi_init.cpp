#include "screen_streamer.h"

#include <algorithm>
#include <cstdint>

#include "napi/native_api.h"

namespace {
int32_t GetIntArg(napi_env env, napi_value* args, size_t argc, size_t index, int32_t fallback)
{
    if (index >= argc || args[index] == nullptr) {
        return fallback;
    }
    napi_valuetype valueType = napi_undefined;
    if (napi_typeof(env, args[index], &valueType) != napi_ok || valueType != napi_number) {
        return fallback;
    }
    int32_t value = fallback;
    if (napi_get_value_int32(env, args[index], &value) != napi_ok) {
        return fallback;
    }
    return value;
}

napi_value Boolean(napi_env env, bool value)
{
    napi_value result = nullptr;
    napi_get_boolean(env, value, &result);
    return result;
}

napi_value Start(napi_env env, napi_callback_info info)
{
    size_t argc = 5;
    napi_value args[5] = { nullptr };
    napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

    bool started = ScreenStreamer::Instance().Start(
        GetIntArg(env, args, argc, 0, 28282),
        GetIntArg(env, args, argc, 1, 720),
        GetIntArg(env, args, argc, 2, 1280),
        GetIntArg(env, args, argc, 3, 15),
        GetIntArg(env, args, argc, 4, 1200000)
    );
    return Boolean(env, started);
}

napi_value Stop(napi_env env, napi_callback_info info)
{
    (void)info;
    return Boolean(env, ScreenStreamer::Instance().Stop());
}

napi_value IsRunning(napi_env env, napi_callback_info info)
{
    (void)info;
    return Boolean(env, ScreenStreamer::Instance().IsRunning());
}
}

EXTERN_C_START
static napi_value Init(napi_env env, napi_value exports)
{
    napi_property_descriptor desc[] = {
        { "start", nullptr, Start, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "stop", nullptr, Stop, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "isRunning", nullptr, IsRunning, nullptr, nullptr, nullptr, napi_default, nullptr }
    };
    napi_define_properties(env, exports, sizeof(desc) / sizeof(desc[0]), desc);
    return exports;
}
EXTERN_C_END

static napi_module screenStreamerModule = {
    .nm_version = 1,
    .nm_flags = 0,
    .nm_filename = nullptr,
    .nm_register_func = Init,
    .nm_modname = "screenstreamer",
    .nm_priv = ((void*)0),
    .reserved = { 0 },
};

extern "C" __attribute__((constructor)) void RegisterScreenStreamerModule(void)
{
    napi_module_register(&screenStreamerModule);
}
