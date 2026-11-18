import os
import sys
import urllib.request
import tarfile
import shutil

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
CLEAN_DIR = os.path.join(DATA_DIR, 'clean_speech')
os.makedirs(CLEAN_DIR, exist_ok=True)

LIBRISPEECH_URL = "https://www.openslr.org/resources/12/test-clean.tar.gz"

def download_librispeech():
    print("Checking LibriSpeech test-clean...")
    tar_path = os.path.join(DATA_DIR, "test-clean.tar.gz")
    
    # Check if already extracted
    speakers = [d for d in os.listdir(CLEAN_DIR) if os.path.isdir(os.path.join(CLEAN_DIR, d))]
    if len(speakers) >= 20:
        print(f"LibriSpeech clean already extracted ({len(speakers)} speakers found).")
        return
        
    if not os.path.exists(tar_path):
        print(f"Downloading {LIBRISPEECH_URL} (~346 MB)...")
        req = urllib.request.Request(LIBRISPEECH_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as resp, open(tar_path, 'wb') as out:
            total_size = int(resp.headers.get('content-length', 0))
            downloaded = 0
            chunk_size = 1024 * 1024
            while True:
                chunk = resp.read(chunk_size)
                if not chunk:
                    break
                out.write(chunk)
                downloaded += len(chunk)
                if total_size:
                    pct = downloaded / total_size * 100
                    sys.stdout.write(f"\rDownloaded {downloaded / 1e6:.1f} / {total_size / 1e6:.1f} MB ({pct:.1f}%)")
                    sys.stdout.flush()
        print("\nDownload complete.")

    print("Extracting LibriSpeech FLAC files...")
    with tarfile.open(tar_path, 'r:gz') as tar:
        for member in tar.getmembers():
            if member.name.endswith('.flac'):
                # Extract to CLEAN_DIR
                # member.name is LibriSpeech/test-clean/{speaker_id}/{chapter_id}/{file_id}.flac
                parts = member.name.split('/')
                if len(parts) >= 4:
                    spk_id = parts[2]
                    spk_dir = os.path.join(CLEAN_DIR, spk_id)
                    os.makedirs(spk_dir, exist_ok=True)
                    target_file = os.path.join(spk_dir, os.path.basename(member.name))
                    f = tar.extractfile(member)
                    with open(target_file, 'wb') as out_f:
                        out_f.write(f.read())
                        
    print("Extraction complete. Removing tar file to save disk space...")
    try:
        os.remove(tar_path)
    except Exception as e:
        print(f"Note: could not remove tar: {e}")

    speakers = [d for d in os.listdir(CLEAN_DIR) if os.path.isdir(os.path.join(CLEAN_DIR, d))]
    print(f"Total speakers extracted: {len(speakers)}")

if __name__ == '__main__':
    download_librispeech()
