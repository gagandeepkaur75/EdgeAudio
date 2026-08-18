import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "./live.css";

function LiveCommunication() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [meetingId, setMeetingId] = useState("");
  const [inputMeetingId, setInputMeetingId] = useState("");

  const [meetingCreated, setMeetingCreated] = useState(false);
  const [isInMeeting, setIsInMeeting] = useState(false);

  const [micEnabled, setMicEnabled] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [localStream, setLocalStream] = useState(null);

  /* =====================================================
     GENERATE MEETING ID
  ===================================================== */

  const generateMeetingId = () => {
    const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let randomPart = "";

    for (let i = 0; i < 6; i++) {
      randomPart += characters.charAt(
        Math.floor(Math.random() * characters.length)
      );
    }

    return `EA-QC-${randomPart}`;
  };


  /* =====================================================
     REQUEST MICROPHONE
  ===================================================== */

  const requestMicrophone = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErrorMessage(
          "Microphone access is not supported by this browser."
        );
        return null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      setLocalStream(stream);
      setMicEnabled(true);

      return stream;
    } catch (error) {
      console.error("Microphone error:", error);

      setErrorMessage(
        "Microphone permission is required to start live communication."
      );

      return null;
    }
  };


  /* =====================================================
     CREATE MEETING
  ===================================================== */

  const createMeeting = async () => {
    setErrorMessage("");

    const newMeetingId = generateMeetingId();

    const stream = await requestMicrophone();

    if (!stream) {
      return;
    }

    setMeetingId(newMeetingId);
    setMeetingCreated(true);
    setIsInMeeting(true);

    setSearchParams({
      meeting: newMeetingId,
    });
  };


  /* =====================================================
     JOIN MEETING
  ===================================================== */

  const joinMeeting = async () => {
    setErrorMessage("");

    const cleanedId = inputMeetingId.trim().toUpperCase();

    if (!cleanedId) {
      setErrorMessage("Please enter a valid meeting ID.");
      return;
    }

    const stream = await requestMicrophone();

    if (!stream) {
      return;
    }

    setMeetingId(cleanedId);
    setMeetingCreated(false);
    setIsInMeeting(true);

    setSearchParams({
      meeting: cleanedId,
    });
  };


  /* =====================================================
     LEAVE MEETING
  ===================================================== */

  const leaveMeeting = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        track.stop();
      });
    }

    setLocalStream(null);
    setMicEnabled(false);
    setMeetingCreated(false);
    setIsInMeeting(false);
    setMeetingId("");

    setSearchParams({});
  };


  /* =====================================================
     MICROPHONE TOGGLE
  ===================================================== */

  const toggleMicrophone = () => {
    if (!localStream) {
      return;
    }

    const audioTracks = localStream.getAudioTracks();

    audioTracks.forEach((track) => {
      track.enabled = !track.enabled;
    });

    setMicEnabled(audioTracks.some((track) => track.enabled));
  };


  /* =====================================================
     COPY MEETING ID
  ===================================================== */

  const copyMeetingId = async () => {
    if (!meetingId) {
      return;
    }

    try {
      await navigator.clipboard.writeText(meetingId);
    } catch (error) {
      console.error("Could not copy meeting ID:", error);
    }
  };


  /* =====================================================
     LOAD MEETING FROM URL
  ===================================================== */

  useEffect(() => {
    const urlMeetingId = searchParams.get("meeting");

    if (urlMeetingId) {
      setMeetingId(urlMeetingId.toUpperCase());
    }
  }, [searchParams]);


  /* =====================================================
     CLEANUP MICROPHONE WHEN PAGE CLOSES
  ===================================================== */

  useEffect(() => {
    return () => {
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          track.stop();
        });
      }
    };
  }, [localStream]);


  /* =====================================================
     PAGE
  ===================================================== */

  return (
    <div className="live-page">

      {/* =================================================
          HEADER
      ================================================= */}

      <header className="live-header">

        <div className="live-brand">
          EdgeAudio<span>-QC</span>
        </div>

        <div className="live-header-status">
          {isInMeeting ? "Live Communication" : "Ready"}
        </div>

        {meetingId && (
          <div className="live-meeting-id">
            {meetingId}
          </div>
        )}

      </header>


      {/* =================================================
          MAIN
      ================================================= */}

      <main className="live-main">

        <div className="live-label">
          LIVE COMMUNICATION
        </div>


        <h1>
          EdgeAudio-QC Meeting
        </h1>


        <p className="live-description">
          Create or join a browser-based communication session
          and evaluate speech quality while keeping raw audio
          on the user's device.
        </p>


        {/* =================================================
            ERROR
        ================================================= */}

        {errorMessage && (
          <div className="live-error">
            {errorMessage}
          </div>
        )}


        {/* =================================================
            CREATE / JOIN
        ================================================= */}

        {!isInMeeting && (
          <section className="meeting-options">

            {/* CREATE */}

            <div className="meeting-card">

              <div className="meeting-number">
                01
              </div>

              <h2>
                Create a Meeting
              </h2>

              <p>
                Create a new EdgeAudio-QC communication room
                and share the generated meeting ID with another
                participant.
              </p>

              <button
                type="button"
                className="create-button"
                onClick={createMeeting}
              >
                Create Meeting
              </button>

            </div>


            {/* JOIN */}

            <div className="meeting-card">

              <div className="meeting-number">
                02
              </div>

              <h2>
                Join a Meeting
              </h2>

              <p>
                Enter an existing EdgeAudio-QC meeting ID
                to enter the communication room.
              </p>

              <input
                type="text"
                value={inputMeetingId}
                onChange={(event) =>
                  setInputMeetingId(event.target.value)
                }
                placeholder="Enter Meeting ID"
                className="meeting-input"
              />

              <button
                type="button"
                className="join-button"
                onClick={joinMeeting}
              >
                Join Meeting
              </button>

            </div>

          </section>
        )}


        {/* =================================================
            MEETING ROOM
        ================================================= */}

        {isInMeeting && (
          <section className="meeting-room">

            <div className="room-top">

              <div>
                <span className="room-label">
                  MEETING ROOM
                </span>

                <h2>
                  {meetingCreated
                    ? "Meeting Created"
                    : "Meeting Joined"}
                </h2>

                <p>
                  Share this meeting ID with the other
                  participant.
                </p>
              </div>


              <div className="room-id-box">

                <span>
                  Meeting ID
                </span>

                <strong>
                  {meetingId}
                </strong>

                <button
                  type="button"
                  onClick={copyMeetingId}
                  className="copy-button"
                >
                  Copy ID
                </button>

              </div>

            </div>


            {/* PARTICIPANTS */}

            <div className="participants">

              {/* LOCAL PARTICIPANT */}

              <div className="participant-card">

                <div className="participant-avatar local">
                  Y
                </div>

                <div className="participant-information">

                  <h3>
                    You
                  </h3>

                  <p>
                    {micEnabled
                      ? "Microphone enabled"
                      : "Microphone disabled"}
                  </p>

                </div>

              </div>


              {/* OTHER PARTICIPANT */}

              <div className="participant-card">

                <div className="participant-avatar remote">
                  P
                </div>

                <div className="participant-information">

                  <h3>
                    Other Participant
                  </h3>

                  <p>
                    Waiting for participant
                  </p>

                </div>

              </div>

            </div>


            {/* CONTROLS */}

            <div className="meeting-controls">

              <button
                type="button"
                className="control-button"
                onClick={toggleMicrophone}
              >
                {micEnabled
                  ? "Mute Microphone"
                  : "Enable Microphone"}
              </button>


              <button
                type="button"
                className="leave-button"
                onClick={leaveMeeting}
              >
                Leave Meeting
              </button>

            </div>

          </section>
        )}


        {/* =================================================
            PRIVACY
        ================================================= */}

        <section className="privacy-box">

          <h2>
            Privacy First
          </h2>

          <p>
            EdgeAudio-QC processes speech audio locally in the
            browser. Raw audio remains on the user's device
            and is not uploaded or stored by the quality
            estimation interface.
          </p>

        </section>


        {/* =================================================
            BACK BUTTON
        ================================================= */}

        <div className="back-area">

          <button
            type="button"
            className="back-button"
            onClick={() => navigate("/")}
          >
            Back to Home
          </button>

        </div>

      </main>


      {/* =================================================
          FOOTER
      ================================================= */}

      <footer className="live-footer">

        EdgeAudio-QC | Privacy-Preserving Speech Quality Estimation

      </footer>

    </div>
  );
}

export default LiveCommunication;