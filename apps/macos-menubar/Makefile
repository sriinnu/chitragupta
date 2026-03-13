# Chitragupta macOS Menubar — build & run targets.
#
# Usage:
#   make          — generate project, build, and run
#   make build    — generate + build only
#   make run      — build if needed, then launch
#   make clean    — remove Xcode project and derived data
#   make generate — regenerate Xcode project from project.yml

SCHEME       := ChitraguptaMenubar
PROJECT      := ChitraguptaMenubar.xcodeproj
CONFIG       := Debug
DERIVED_DATA := $(HOME)/Library/Developer/Xcode/DerivedData

# Find the DerivedData build product (xcodebuild puts it under a hashed dir name)
APP_DIR       = $(shell find "$(DERIVED_DATA)" -maxdepth 3 -type d \
                  -name "$(SCHEME)-*" -print -quit 2>/dev/null)
APP_PATH      = $(APP_DIR)/Build/Products/$(CONFIG)/$(SCHEME).app

.PHONY: all build run generate clean kill

all: build run

generate:
	@echo "→ Generating Xcode project..."
	@xcodegen generate

build: generate
	@echo "→ Building $(SCHEME) ($(CONFIG))..."
	@xcodebuild -project $(PROJECT) -scheme $(SCHEME) \
		-configuration $(CONFIG) build 2>&1 \
		| grep -E "(error:|warning:.*\.swift|BUILD)" \
		| grep -v "AppIcon" \
		|| true
	@echo "→ Build complete."

run: kill
	@echo "→ Launching $(SCHEME)..."
	@open "$(APP_PATH)"

kill:
	@pkill -f $(SCHEME) 2>/dev/null || true

clean: kill
	@echo "→ Cleaning..."
	@rm -rf $(PROJECT)
	@[ -n "$(APP_DIR)" ] && rm -rf "$(APP_DIR)" || true
	@echo "→ Clean complete."
