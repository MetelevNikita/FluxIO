/*
 * FluxIO Dynamic Title reference project generator.
 * Compatible with Adobe After Effects ExtendScript (ES3 syntax).
 *
 * Run with: File -> Scripts -> Run Script File...
 * The script creates FluxIO_Dynamic_Title_Reference.aep next to itself.
 */

(function createFluxIODynamicTitleReference() {
    function addAutoBezierKeys(property, times, values) {
        var i;
        for (i = 0; i < times.length; i += 1) {
            property.setValueAtTime(times[i], values[i]);
        }
        for (i = 1; i <= property.numKeys; i += 1) {
            try {
                property.setInterpolationTypeAtKey(
                    i,
                    KeyframeInterpolationType.BEZIER,
                    KeyframeInterpolationType.BEZIER
                );
                property.setTemporalAutoBezierAtKey(i, true);
            } catch (ignoreInterpolationError) {}
        }
    }

    function setLayerComment(layer, comment) {
        try {
            layer.comment = comment;
        } catch (ignoreCommentError) {}
    }

    function addMarker(comp, time, label) {
        try {
            comp.markerProperty.setValueAtTime(time, new MarkerValue(label));
        } catch (ignoreMarkerError) {}
    }

    function setTextFont(textDocument, candidates) {
        var i;
        for (i = 0; i < candidates.length; i += 1) {
            try {
                textDocument.font = candidates[i];
                return candidates[i];
            } catch (ignoreFontError) {}
        }
        return "";
    }

    if (app.project && app.project.numItems > 0) {
        if (!confirm(
            "Скрипт создаст новый проект After Effects.\n\n" +
            "Сохраните текущую работу перед продолжением. Создать новый проект?"
        )) {
            return;
        }
    }

    var project = app.newProject();
    if (!project) {
        project = app.project;
    }

    app.beginUndoGroup("Create FluxIO Dynamic Title Reference");

    var width = 1920;
    var height = 1080;
    var pixelAspect = 1;
    var duration = 5;
    var frameRate = 25;

    var exportFolder = project.items.addFolder("01_EXPORT_THIS");
    var previewFolder = project.items.addFolder("02_PREVIEW");

    var mainComp = project.items.addComp(
        "FluxIO Dynamic Title - EXPORT",
        width,
        height,
        pixelAspect,
        duration,
        frameRate
    );
    mainComp.parentFolder = exportFolder;
    mainComp.bgColor = [0, 0, 0];
    mainComp.comment =
        "Export this composition with Bodymovin. Background is transparent. " +
        "The fit:status layer is resized by FluxIO to the real status text.";

    addMarker(mainComp, 0, "IN START");
    addMarker(mainComp, 0.72, "IN COMPLETE");
    addMarker(mainComp, 4.96, "END");

    /* Adaptive plate ------------------------------------------------------- */
    var plate = mainComp.layers.addShape();
    plate.name = "fit:status";
    plate.label = 9;
    setLayerComment(
        plate,
        "IMPORTANT: fit:status targets the Text Layer named status. " +
        "Keep Rectangle Path > Size static; animate Layer Transform instead."
    );

    var plateRoot = plate.property("ADBE Root Vectors Group");
    var plateGroup = plateRoot.addProperty("ADBE Vector Group");
    plateGroup.name = "Adaptive plate";
    var plateContents = plateGroup.property("ADBE Vectors Group");
    var plateRect = plateContents.addProperty("ADBE Vector Shape - Rect");
    plateRect.name = "PLATE SIZE - KEEP STATIC";
    plateRect.property("ADBE Vector Rect Size").setValue([660, 132]);
    plateRect.property("ADBE Vector Rect Position").setValue([520, 840]);
    plateRect.property("ADBE Vector Rect Roundness").setValue(30);

    var plateFill = plateContents.addProperty("ADBE Vector Graphic - Fill");
    plateFill.name = "FluxIO blue";
    plateFill.property("ADBE Vector Fill Color").setValue([0.18, 0.31, 0.92]);
    plateFill.property("ADBE Vector Fill Opacity").setValue(96);

    var plateStroke = plateContents.addProperty("ADBE Vector Graphic - Stroke");
    plateStroke.name = "Soft edge";
    plateStroke.property("ADBE Vector Stroke Color").setValue([0.43, 0.58, 1.0]);
    plateStroke.property("ADBE Vector Stroke Opacity").setValue(70);
    plateStroke.property("ADBE Vector Stroke Width").setValue(3);

    var plateTransform = plate.property("ADBE Transform Group");
    addAutoBezierKeys(
        plateTransform.property("ADBE Position"),
        [0, 0.52],
        [[-150, 0], [0, 0]]
    );
    addAutoBezierKeys(
        plateTransform.property("ADBE Scale"),
        [0, 0.52],
        [[94, 94], [100, 100]]
    );
    addAutoBezierKeys(
        plateTransform.property("ADBE Opacity"),
        [0, 0.34],
        [0, 100]
    );

    /* Decorative live dot ------------------------------------------------- */
    var dot = mainComp.layers.addShape();
    dot.name = "decor:live-dot";
    dot.label = 10;
    setLayerComment(dot, "Decorative layer. It is not resized by fit:status.");

    var dotRoot = dot.property("ADBE Root Vectors Group");
    var dotGroup = dotRoot.addProperty("ADBE Vector Group");
    dotGroup.name = "Live dot";
    var dotContents = dotGroup.property("ADBE Vectors Group");
    var dotEllipse = dotContents.addProperty("ADBE Vector Shape - Ellipse");
    dotEllipse.property("ADBE Vector Ellipse Size").setValue([24, 24]);
    dotEllipse.property("ADBE Vector Ellipse Position").setValue([244, 840]);
    var dotFill = dotContents.addProperty("ADBE Vector Graphic - Fill");
    dotFill.property("ADBE Vector Fill Color").setValue([1.0, 0.33, 0.30]);
    dotFill.property("ADBE Vector Fill Opacity").setValue(100);

    var dotTransform = dot.property("ADBE Transform Group");
    addAutoBezierKeys(
        dotTransform.property("ADBE Position"),
        [0.18, 0.48],
        [[-90, 0], [0, 0]]
    );
    addAutoBezierKeys(
        dotTransform.property("ADBE Scale"),
        [0.20, 0.50, 0.70],
        [[0, 0], [118, 118], [100, 100]]
    );
    addAutoBezierKeys(
        dotTransform.property("ADBE Opacity"),
        [0.18, 0.38],
        [0, 100]
    );

    /* Text field used by FluxIO ------------------------------------------ */
    var title = mainComp.layers.addText("ПРЯМОЙ ЭФИР");
    title.name = "status";
    title.label = 2;
    setLayerComment(
        title,
        "FluxIO dynamic field. Select status in Dynamic title > Поле для текста. " +
        "FluxIO clears this template value and draws the real text with FFmpeg."
    );

    var titleDocumentProperty = title
        .property("ADBE Text Properties")
        .property("ADBE Text Document");
    var titleDocument = titleDocumentProperty.value;
    titleDocument.text = "ПРЯМОЙ ЭФИР";
    titleDocument.fontSize = 58;
    titleDocument.applyFill = true;
    titleDocument.fillColor = [1, 1, 1];
    titleDocument.applyStroke = false;
    titleDocument.justification = ParagraphJustification.LEFT_JUSTIFY;
    titleDocument.tracking = 15;
    setTextFont(titleDocument, ["Arial-BoldMT", "Arial-Bold", "Arial"]);
    titleDocumentProperty.setValue(titleDocument);

    var titleTransform = title.property("ADBE Transform Group");
    addAutoBezierKeys(
        titleTransform.property("ADBE Position"),
        [0.20, 0.66],
        [[304, 860], [274, 860]]
    );
    addAutoBezierKeys(
        titleTransform.property("ADBE Opacity"),
        [0.20, 0.58],
        [0, 100]
    );

    /* Non-rendering instructions inside the project ---------------------- */
    var note = mainComp.layers.addText(
        "REFERENCE ONLY — export the comp with transparent background\n" +
        "Text Layer: status    |    Shape Layer: fit:status"
    );
    note.name = "REFERENCE_NOTES_DO_NOT_EXPORT";
    note.guideLayer = true;
    note.enabled = false;
    note.label = 5;

    /* Preview composition ------------------------------------------------ */
    var previewComp = project.items.addComp(
        "FluxIO Dynamic Title - PREVIEW",
        width,
        height,
        pixelAspect,
        duration,
        frameRate
    );
    previewComp.parentFolder = previewFolder;
    previewComp.bgColor = [0.025, 0.03, 0.045];
    previewComp.comment = "Preview only. Do not export this composition to Bodymovin.";

    var previewBackground = previewComp.layers.addSolid(
        [0.025, 0.03, 0.045],
        "Preview background",
        width,
        height,
        pixelAspect,
        duration
    );
    previewBackground.locked = true;
    var previewTitle = previewComp.layers.addText("ANIMATION PREVIEW");
    previewTitle.name = "Preview label";
    var previewTitleDocumentProperty = previewTitle
        .property("ADBE Text Properties")
        .property("ADBE Text Document");
    var previewTitleDocument = previewTitleDocumentProperty.value;
    previewTitleDocument.fontSize = 28;
    previewTitleDocument.applyFill = true;
    previewTitleDocument.fillColor = [0.48, 0.53, 0.64];
    previewTitleDocument.tracking = 120;
    setTextFont(previewTitleDocument, ["Arial-BoldMT", "Arial-Bold", "Arial"]);
    previewTitleDocumentProperty.setValue(previewTitleDocument);
    previewTitle.property("ADBE Transform Group").property("ADBE Position").setValue([200, 170]);

    var mainPreviewLayer = previewComp.layers.add(mainComp);
    mainPreviewLayer.name = "Dynamic Title reference";

    /* Save beside the JSX ------------------------------------------------ */
    var scriptFile = new File($.fileName);
    var outputFile = new File(
        scriptFile.parent.fsName + "/FluxIO_Dynamic_Title_Reference.aep"
    );
    if (outputFile.exists) {
        if (!confirm("Файл уже существует:\n" + outputFile.fsName + "\n\nПерезаписать?")) {
            outputFile = File.saveDialog("Сохранить проект After Effects", "*.aep");
        }
    }

    if (outputFile) {
        project.save(outputFile);
    }

    previewComp.openInViewer();
    app.endUndoGroup();

    alert(
        "FluxIO Dynamic Title создан.\n\n" +
        "Для Bodymovin экспортируйте только композицию:\n" +
        "FluxIO Dynamic Title - EXPORT\n\n" +
        "Проект:\n" + (outputFile ? outputFile.fsName : "не сохранён")
    );
}());
