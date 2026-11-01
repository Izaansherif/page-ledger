$path = "D:\Documents\Default Project\pagebook/index.html"
$content = Get-Content -Path $path -Raw

$old = @'
      <!-- All customers -->
      <div class="home-section" id="home-all" hidden>
        <div class="home-section-head">
          <h2 class="home-section-title">All customers</h2>
        </div>
        <div id="home-all-list" class="home-all-list"></div>
        <p class="home-empty" id="home-all-empty" hidden>No customers yet. Take a photo of a page or add one manually.</p>
      </div>
'@

$new = @'
      <!-- All customers -->
      <div class="home-section" id="home-all" hidden>
        <div class="home-section-head">
          <h2 class="home-section-title">All customers</h2>
          <button id="btn-add-customer-home" class="btn btn--primary btn--small" type="button">Add customer</button>
        </div>
        <div id="home-all-list" class="home-all-list"></div>
        <p class="home-empty" id="home-all-empty" hidden>No customers yet. Take a photo of a page or add one manually.</p>
      </div>
'@

if ($content -match [regex]::Escape($old)) {
    $content = $content -replace [regex]::Escape($old), $new
    Set-Content -Path $path -Value $content -Encoding UTF8
    "Replacement successful"
} else {
    "OLD STRING NOT FOUND"
    # Debug
    $idx = $content.IndexOf('All customers')
    if ($idx -ge 0) { "Found at: $idx"; $content.Substring($idx, 150) }
}