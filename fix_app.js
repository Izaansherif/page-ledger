import re

with open("D:\\Documents\\Default Project\\pagebook/js/app.js", "r", encoding="utf-8") as f:
    content = f.read()

# Find handleAddCustomerSubmit function
start = content.find("async function handleAddCustomerSubmit(e)")
if start == -1:
    print("Not found")
else:
    # Find matching closing brace
    depth = 0
    end = start
    for i in range(start, len(content)):
        if content[i] == "{":
            depth += 1
        elif content[i] == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    
    old_func = content[start:end]
    
    new_func = '''async function handleAddCustomerSubmit(e) {
  e.preventDefault();
  const btn = $("#btn-add-customer-save");
  const btnText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving\\u2026";

  try {
    const name = $("#add-customer-name").value.trim();
    const phone = $("#add-customer-phone").value.trim();
    const amountDue = parseFloat($("#add-customer-amount-due")?.value) || null;

    if (!name || !phone) {
      showToast("Please fill in name and phone number.");
      btn.disabled = false;
      btn.textContent = btnText;
      return;
    }

    const user = auth().getSession()?.user;

    if (state.demoStore) {
      const store = demo.read();
      const pageId = crypto.randomUUID();
      const newPage = {
        id: pageId,
        owner: user?.id || "owner@this-device",
        created_at: new Date().toISOString(),
        taken_on: new Date().toISOString(),
        demo: true,
        phone: phone,
        phone_rows: [{
          id: crypto.randomUUID(),
          row_index: 0,
          name: name,
          phone: phone,
          amount_paid: null,
          amount_due: amountDue,
          note: "",
          language: "en",
          payments: [],
        }],
      };
      const storeData = demo.read();
      storeData.pages.unshift(newPage);
      demo.write(storeData);
    } else {
      const res = await sb.savePage({
        photoPath: null,
        takenOn: new Date().toISOString(),
        pageTotalWritten: null,
        pageWarnings: [],
        rows: [{
          rowIndex: 0,
          name: name,
          phone: phone,
          note: "",
          amountPaid: null,
          amountDue: amountDue,
          followUpText: null,
          followUpDate: null,
          followUpConfirmed: false,
          struckOut: false,
          included: true,
          raw: name + " " + phone + (amountDue ? " " + amountDue : ""),
          confidence: {},
          flags: [],
        }],
        userId: user?.id,
      });
    }

    await loadPeople();
    renderHomeView();

    btn.textContent = btnText;
    btn.disabled = false;
    closeAddCustomerSheet();
    showToast("Added " + name);
  } catch (e) {
    console.error("Add customer error:", e);
    btn.disabled = false;
    btn.textContent = "Save customer";
  }
}'''

    new_content = content[:start] + new_func + content[end:]
    with open("D:\\Documents\\Default Project\\pagebook/js/app.js", "w", encoding="utf-8") as f:
        f.write(new_content)
    print("Replacement successful")
