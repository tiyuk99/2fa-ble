import simplepyble


adapters = simplepyble.Adapter.get_adapters()
if not adapters:
    raise RuntimeError("No BLE adapters found.")

adapter = adapters[0]
adapter.scan_for(2000)  # scan for 2 seconds

for device in adapter.scan_get_results():
    print(f"{device.identifier()} | {device.address()}")
