# Builds the engine's Python environment (engine\.venv) and downloads the models (engine\models).
# Needs uv and internet once; after that the engine runs offline.
$ErrorActionPreference = 'Stop'
$engine = $PSScriptRoot
$models = Join-Path $engine 'models'

Set-Location $engine
uv venv --python 3.12 .venv
# torch built for CUDA 13 (RTX 50 series needs sm_120, CUDA 12.8 or later).
uv pip install --python .venv\Scripts\python.exe torch --index-url https://download.pytorch.org/whl/cu130
uv pip install --python .venv\Scripts\python.exe -r requirements.txt

New-Item -ItemType Directory -Force $models | Out-Null
$files = @{
    'comictextdetector.pt.onnx' = 'https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.3/comictextdetector.pt.onnx'
    'big-lama.pt'               = 'https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt'
}
foreach ($name in $files.Keys) {
    $target = Join-Path $models $name
    if (-not (Test-Path $target)) { curl.exe -L --fail -o $target $files[$name] }
}
# manga-ocr's model (kha-white/manga-ocr-base) into models\hf.
$env:HF_HOME = Join-Path $models 'hf'
.venv\Scripts\python.exe -c "from huggingface_hub import snapshot_download; print(snapshot_download('kha-white/manga-ocr-base'))"
Get-FileHash (Join-Path $models '*') -Algorithm SHA256 | Format-Table Hash, Path -AutoSize
