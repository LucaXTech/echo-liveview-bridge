'use strict';

const ENTITY_ID   = "YOUR_ENTITY_ID";
const MANUFACTURER = "Amazon";
const DEVICE_TYPE  = "YOUR_DEVICE_TYPE";

const CAPTURE_MS = 15000;
const MAX_BYTES   = 32 * 1024 * 1024;

let capturePath   = null;
let captureStream = null;
let captureActive = true;
let captureStarted = false;
let capturedBytes = 0;
let surfaceRef    = null;

const avcCodecs = Object.create(null);

function log(s) {
    console.log("[HEADLESS-H264] " + s);
}

function codecKey(codec) {
    try {
        return codec.toString();
    } catch (_) {
        return "<codec>";
    }
}

Java.perform(function () {

    const MediaCodec = Java.use("android.media.MediaCodec");
    const File = Java.use("java.io.File");
    const FileOutputStream = Java.use("java.io.FileOutputStream");
    const Buffer = Java.use("java.nio.Buffer");

    // ============================================================
    // 1. MEDIA CODEC: IDENTIFICA IL DECODER H.264
    // ============================================================

    const configure = MediaCodec.configure.overload(
        "android.media.MediaFormat",
        "android.view.Surface",
        "android.media.MediaCrypto",
        "int"
    );

    configure.implementation = function (
        format,
        surface,
        crypto,
        flags
    ) {
        let mime = "";

        try {
            mime = format.getString("mime");
        } catch (_) {}

        const key = codecKey(this);

        if (mime !== null &&
            mime !== undefined &&
            mime.toString().toLowerCase() === "video/avc") {

            avcCodecs[key] = true;

            console.log("");
            log("==========================================");
            log("DECODER H264 CONFIGURATO");
            log("codec = " + key);

            try {
                log("format = " + format.toString());
            } catch (_) {}

            log("==========================================");
        }

        return configure.call(
            this,
            format,
            surface,
            crypto,
            flags
        );
    };


    // ============================================================
    // 2. COPIA INPUT COMPRESSO PRIMA DEL DECODER
    // ============================================================

    const queueInputBuffer = MediaCodec.queueInputBuffer.overload(
        "int",
        "int",
        "int",
        "long",
        "int"
    );

    queueInputBuffer.implementation = function (
        index,
        offset,
        size,
        pts,
        flags
    ) {
        const key = codecKey(this);

        if (
            captureActive &&
            avcCodecs[key] === true &&
            size > 0 &&
            capturePath !== null &&
            capturedBytes < MAX_BYTES
        ) {
            try {
                if (captureStream === null) {

                    try {
                        const old = File.$new(capturePath);
                        if (old.exists()) {
                            old.delete();
                        }
                    } catch (_) {}

                    captureStream =
                        FileOutputStream.$new(capturePath, false);

                    log("CAPTURE START");
                    log("file = headless-echo.h264");

                    captureStarted = true;

                    setTimeout(function () {
                        Java.perform(function () {

                            if (!captureActive)
                                return;

                            captureActive = false;

                            try {
                                if (captureStream !== null) {
                                    captureStream.flush();
                                    captureStream.close();
                                }
                            } catch (e) {
                                log("close ERROR: " + e);
                            }

                            captureStream = null;

                            console.log("");
                            log("==========================================");
                            log("CAPTURE DONE");
                            log("bytes = " + capturedBytes);
                            log("durata target = " + CAPTURE_MS + " ms");
                            log("==========================================");
                        });
                    }, CAPTURE_MS);
                }

                const buffer = this.getInputBuffer(index);

                if (buffer !== null) {

                    const duplicate = buffer.duplicate();

                    // Frida non risolve correttamente position()/limit()
                    // sul wrapper ByteBuffer concreto. Il cast a Buffer
                    // espone invece correttamente i setter ereditati.
                    const genericBuffer =
                        Java.cast(
                            duplicate,
                            Buffer
                        );

                    genericBuffer.position(offset);
                    genericBuffer.limit(offset + size);

                    // Scrittura diretta del DirectByteBuffer sul file.
                    // Niente Java.array(), niente copia byte-per-byte.
                    const channel =
                        captureStream.getChannel();

                    let written = 0;

                    while (duplicate.hasRemaining()) {
                        const n =
                            channel.write
                                .overload("java.nio.ByteBuffer")
                                .call(
                                    channel,
                                    duplicate
                                );

                        if (n <= 0) {
                            break;
                        }

                        written += n;
                    }

                    capturedBytes += written;

                    if (written !== size) {
                        log(
                            "WARNING short write: " +
                            written +
                            "/" +
                            size
                        );
                    }

                    if (capturedBytes >= MAX_BYTES) {
                        captureActive = false;

                        try {
                            captureStream.flush();
                            captureStream.close();
                        } catch (_) {}

                        captureStream = null;

                        log(
                            "CAPTURE STOP: raggiunto limite " +
                            MAX_BYTES +
                            " bytes"
                        );
                    }
                }

            } catch (e) {
                log("capture ERROR: " + e);
            }
        }

        return queueInputBuffer.call(
            this,
            index,
            offset,
            size,
            pts,
            flags
        );
    };


    log("MediaCodec hooks installati");


    // ============================================================
    // 3. CALLBACK CAMERA SENZA STAMPARE SESSION ID
    // ============================================================

    try {
        const Manager = Java.use(
            "com.amazon.alexa.smarthomecameras.session.RtcscCameraSessionManager"
        );

        const first =
            Manager.onFirstFrameRendered.overloads[0];

        first.implementation = function (
            sessionId,
            side
        ) {
            log(
                "FIRST FRAME RENDERED side=" +
                side.toString()
            );

            return first.call(
                this,
                sessionId,
                side
            );
        };

        const resolution =
            Manager.onFrameResolutionChanged.overloads[0];

        resolution.implementation = function (
            sessionId,
            side,
            width,
            height,
            extra
        ) {
            log(
                "FRAME " +
                side.toString() +
                " " +
                width +
                "x" +
                height
            );

            return resolution.call(
                this,
                sessionId,
                side,
                width,
                height,
                extra
            );
        };

        const media =
            Manager.onMediaConnectionStateChanged.overloads[0];

        media.implementation = function (
            sessionId,
            state
        ) {
            log(
                "MEDIA CONNECTION = " +
                state.toString()
            );

            return media.call(
                this,
                sessionId,
                state
            );
        };

    } catch (e) {
        log("camera callback hook ERROR: " + e);
    }


    // ============================================================
    // 4. BOOTSTRAP HEADLESS
    // ============================================================

    function tryBootstrap(attempt) {

        Java.perform(function () {

            try {
                const ActivityThread =
                    Java.use("android.app.ActivityThread");

                const app =
                    ActivityThread.currentApplication();

                if (app === null) {
                    if (attempt < 20) {
                        setTimeout(
                            function () {
                                tryBootstrap(attempt + 1);
                            },
                            1000
                        );
                    }
                    return;
                }

                const context =
                    app.getApplicationContext();

                capturePath =
                    context
                        .getFilesDir()
                        .getAbsolutePath()
                        .toString() +
                    "/headless-echo.h264";

                const Provider = Java.use(
                    "com.amazon.alexa.smarthomecameras.dependencies.components.CameraComponentProvider"
                );

                let existing =
                    Provider.getCameraComponent();

                if (existing !== null) {
                    log("CameraComponent già presente");
                    startCamera(existing);
                    return;
                }

                let routingFound = false;

                Java.choose(
                    "com.amazon.alexa.routing.api.RoutingService",
                    {
                        onMatch: function (routingService) {

                            if (routingFound)
                                return;

                            routingFound = true;

                            try {
                                log(
                                    "RoutingService = " +
                                    routingService.$className
                                );

                                const Dagger =
                                    Java.use(
                                        "com.amazon.alexa.smarthomecameras.dependencies.components.DaggerCameraComponent"
                                    );

                                const ContextModule =
                                    Java.use(
                                        "com.amazon.alexa.smarthomecameras.dependencies.modules.ContextModule"
                                    );

                                const RoutingModule =
                                    Java.use(
                                        "com.amazon.alexa.smarthomecameras.dependencies.modules.RoutingServiceModule"
                                    );

                                const component =
                                    Dagger
                                        .builder()
                                        .contextModule(
                                            ContextModule.$new(
                                                context
                                            )
                                        )
                                        .routingServiceModule(
                                            RoutingModule.$new(
                                                routingService
                                            )
                                        )
                                        .build();

                                Provider.setCameraComponent(
                                    component
                                );

                                log(
                                    "CameraComponent headless creato"
                                );

                                startCamera(component);

                            } catch (e) {
                                log(
                                    "bootstrap ERROR: " + e
                                );

                                if (e.stack) {
                                    console.log(e.stack);
                                }
                            }
                        },

                        onComplete: function () {

                            if (
                                !routingFound &&
                                attempt < 20
                            ) {
                                log(
                                    "RoutingService non ancora pronto; retry"
                                );

                                setTimeout(
                                    function () {
                                        tryBootstrap(
                                            attempt + 1
                                        );
                                    },
                                    1000
                                );
                            }
                        }
                    }
                );

            } catch (e) {
                log(
                    "tryBootstrap ERROR: " + e
                );

                if (attempt < 20) {
                    setTimeout(
                        function () {
                            tryBootstrap(attempt + 1);
                        },
                        1000
                    );
                }
            }
        });
    }


    // ============================================================
    // 5. AVVIA REQUEST START LIVE VIEW
    // ============================================================

    function startCamera(component) {

        Java.perform(function () {

            try {
                const EntityId = Java.use(
                    "com.amazon.alexa.smarthomecameras.model.EntityId"
                );

                const manager =
                    component.cameraSessionManager();

                log(
                    "CameraSessionManager pronto"
                );

                // ====================================================
                // PRE-REGISTRA RTCSC
                // Usa direttamente il metodo Amazon verificato.
                // ====================================================

                try {
                    const ManagerClass = Java.use(
                        "com.amazon.alexa.smarthomecameras.session.RtcscCameraSessionManager"
                    );

                    const reg =
                        ManagerClass[
                            "lambda$requestSessionForDeviceV2$1"
                        ].overload();

                    reg.call(manager);

                    log(
                        "PRE-REGISTER RTCSC completato"
                    );

                } catch (e) {
                    log(
                        "PRE-REGISTER ERROR: " +
                        e
                    );

                    return;
                }

                log(
                    "attendo 1500 ms dopo registrazione..."
                );

                setTimeout(function () {
                    Java.perform(function () {

                        log(
                            "invio UNICO RequestStartLiveView..."
                        );

                        manager.requestSessionForDevice(
                    EntityId.create(ENTITY_ID),
                    MANUFACTURER,
                    DEVICE_TYPE
                        );

                        log(
                            "RequestStartLiveView inviato"
                        );

                        waitForSession(manager, 0);

                    });
                }, 1500);

            } catch (e) {
                log(
                    "startCamera ERROR: " + e
                );
            }
        });
    }


    // ============================================================
    // 6. ASPETTA SESSION ID SENZA STAMPARLO
    // ============================================================

    function waitForSession(manager, attempt) {

        setTimeout(function () {

            Java.perform(function () {

                try {
                    const active =
                        manager.getActiveSessionId();

                    if (active !== null) {

                        log(
                            "sessione RTCSC disponibile"
                        );

                        bindSink(
                            active
                                .getValue()
                                .toString(),
                            0
                        );

                        return;
                    }

                } catch (_) {}

                if (attempt < 120) {
                    waitForSession(
                        manager,
                        attempt + 1
                    );
                } else {
                    log(
                        "TIMEOUT aspettando sessione RTCSC"
                    );
                }
            });

        }, 250);
    }


    // ============================================================
    // 7. CREA MICRO SURFACE 16x16
    // ============================================================

    function bindSink(sessionId, attempt) {

        Java.perform(function () {

            let chosen = null;

            Java.choose(
                "android.app.Activity",
                {
                    onMatch: function (activity) {

                        if (chosen !== null)
                            return;

                        try {
                            if (activity.isFinishing())
                                return;

                            if (activity.isDestroyed())
                                return;

                            const decor =
                                activity
                                    .getWindow()
                                    .getDecorView();

                            if (!decor.isAttachedToWindow())
                                return;

                            if (!decor.hasWindowFocus())
                                return;

                            chosen =
                                Java.retain(activity);

                        } catch (_) {}
                    },

                    onComplete: function () {

                        if (chosen === null) {

                            if (attempt < 40) {
                                setTimeout(
                                    function () {
                                        bindSink(
                                            sessionId,
                                            attempt + 1
                                        );
                                    },
                                    250
                                );
                            } else {
                                log(
                                    "nessuna Activity valida"
                                );
                            }

                            return;
                        }

                        log(
                            "Activity = " +
                            chosen
                                .getClass()
                                .getName()
                        );

                        createSurface(
                            chosen,
                            sessionId
                        );
                    }
                }
            );
        });
    }


    function createSurface(activity, sessionId) {

        Java.scheduleOnMainThread(function () {

            try {
                const RTCSurfaceView = Java.use(
                    "com.amazon.rtcsc.appclient.surfaceview.RTCSurfaceView"
                );

                const ViewDirection = Java.use(
                    "com.amazon.rtcsc.appclient.surfaceview.RTCSurfaceViewInterface$ViewDirection"
                );

                const FrameLayoutParams = Java.use(
                    "android.widget.FrameLayout$LayoutParams"
                );

                const ViewGroup = Java.use(
                    "android.view.ViewGroup"
                );

                const surface =
                    RTCSurfaceView.$new(activity);

                const params =
                    FrameLayoutParams.$new(
                        16,
                        16
                    );

                const decor =
                    Java.cast(
                        activity
                            .getWindow()
                            .getDecorView(),
                        ViewGroup
                    );

                surface.setVisibility(0);
                surface.setAlpha(0.01);

                decor.addView(
                    surface,
                    params
                );

                surfaceRef =
                    Java.retain(surface);

                log(
                    "micro RTCSurfaceView 16x16 aggiunta"
                );

                const remote =
                    ViewDirection.valueOf(
                        "REMOTE_VIEW"
                    );

                surface.init(
                    sessionId,
                    remote
                );

                log(
                    "RTCSurfaceView bind REMOTE_VIEW completato"
                );

            } catch (e) {
                log(
                    "surface ERROR: " + e
                );

                if (e.stack) {
                    console.log(e.stack);
                }
            }
        });
    }


    // Alexa deve prima completare il normale startup.
    setTimeout(function () {
        log("avvio bootstrap headless");
        tryBootstrap(0);
    }, 15000);
});
