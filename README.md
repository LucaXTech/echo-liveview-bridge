# Echo LiveView Bridge

Experimental interoperability project for receiving the built-in camera stream of an Amazon Echo Show through the Alexa Live View / RTCSessionController path and exposing the resulting H.264 video to local systems.

> [!WARNING]
> This is an unofficial research project and is not affiliated with, endorsed by, or supported by Amazon.

## Current status

Proof of concept achieved:

- headless RequestStartLiveView
- RTCSessionController session establishment
- WebRTC media connection
- remote video reception without opening the normal Alexa camera screen
- H.264/AVC extraction before decode
- Annex-B elementary stream capture
- in-band SPS / PPS / IDR
- successful playback with FFmpeg / ffplay

Observed adaptive video resolutions include:

- 640x360
- 960x540
- 1280x720

The current proof of concept still relies on the official Alexa Android runtime plus Frida as a protocol/media research environment.

## Goal

The intended production implementation is a standalone Linux daemon for Raspberry Pi or similar hosts, using authenticated Amazon signaling, WebRTC, H.264 RTP reception/depacketization, and local publication through MediaMTX/go2rtc.

## Repository policy

This repository intentionally does not contain Amazon APKs, decompiled Amazon source/resources, authentication cookies/tokens, TURN credentials, private endpoint/entity identifiers, session identifiers, packet captures, or private camera recordings.

## Responsible use

Use this project only with devices and accounts you own or are authorized to access.

## License

MIT
