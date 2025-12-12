// NodeEditor.jsx
import React, { useState, useRef } from "react";

function createIdGenerator(prefix) {
  let i = 1;
  return () => `${prefix}_${i++}`;
}

const genNodeId = createIdGenerator("node");
const genPortId = createIdGenerator("port");
const genEdgeId = createIdGenerator("edge");

// ---- 레이아웃 상수 ----
const PORT_SPACING = 20;
const PORT_START_OFFSET_Y = 30; // node.y 에서 포트 시작 offset
const PORT_BOTTOM_MARGIN = 20;
const NODE_MIN_HEIGHT = 80;

// 포트 개수에 따라 노드 높이 계산
function calcNodeHeight(inputCount, outputCount) {
  const maxPorts = Math.max(inputCount, outputCount);
  if (maxPorts <= 0) return NODE_MIN_HEIGHT;

  const needed =
    PORT_START_OFFSET_Y + (maxPorts - 1) * PORT_SPACING + PORT_BOTTOM_MARGIN;

  return Math.max(NODE_MIN_HEIGHT, needed);
}

// title에서 index 추출: "vcap@3" -> 3
function getIndexFromTitle(title) {
  const parts = title.split("@");
  if (parts.length !== 2) return 0;
  const n = parseInt(parts[1], 10);
  return Number.isNaN(n) ? 0 : n;
}

// title 생성: type + index -> "vcap@3"
function makeTitle(type, index) {
  return `${type}@${index}`;
}

// 타입 컬럼 순서
const TYPE_COLUMNS = ["vcap", "vproc", "venc", "vdec", "vout"];

// 텍스트 파서: Export 포맷을 다시 그래프로 복원
// 텍스트 파서: Export 포맷을 다시 그래프로 복원
function parseConfigText(text) {
  const lines = text.split(/\r?\n/);

  // title -> { title, type, inputCount, outputCount }
  const nodeInfoMap = new Map();
  const binds = []; // { srcTitle, srcIdx, dstTitle, dstIdx }
  const internalConns = new Map(); // title -> [ { inIdx, outIdx } ]

  let currentNodeTitle = null;
  let inBind = false;

  function ensureNodeInfo(title) {
    if (!nodeInfoMap.has(title)) {
      const type = title.split("@")[0];
      nodeInfoMap.set(title, {
        title,
        type,
        inputCount: 0,
        outputCount: 0,
      });
    }
    return nodeInfoMap.get(title);
  }

  for (let raw of lines) {
    const line = raw.trim();
    if (!line || line === "{" || line === "}") continue;

    // bind 블록 진입
    if (line.startsWith("bind")) {
      inBind = true;
      currentNodeTitle = null;
      continue;
    }

    // bind 블록 처리
    if (inBind) {
      if (line.startsWith("}")) {
        inBind = false;
        continue;
      }

      // 예: vcap@0:0 -> vproc@0:0
      const m = line.match(
        /^([A-Za-z0-9_@]+)\s*:\s*(\d+)\s*->\s*([A-Za-z0-9_@]+)\s*:\s*(\d+)/
      );
      if (!m) continue;

      const [, srcTitle, sIdxStr, dstTitle, dIdxStr] = m;
      const srcIdx = parseInt(sIdxStr, 10);
      const dstIdx = parseInt(dIdxStr, 10);
      if (Number.isNaN(srcIdx) || Number.isNaN(dstIdx)) continue;

      binds.push({ srcTitle, srcIdx, dstTitle, dstIdx });

      const srcInfo = ensureNodeInfo(srcTitle);
      const dstInfo = ensureNodeInfo(dstTitle);

      if (srcInfo.outputCount < srcIdx + 1) srcInfo.outputCount = srcIdx + 1;
      if (dstInfo.inputCount < dstIdx + 1) dstInfo.inputCount = dstIdx + 1;

      continue;
    }

    // 노드 헤더: vcap@0 : {  혹은  vcap@0:{
    const headerMatch = line.match(/^([A-Za-z0-9_@]+)\s*:/);
    if (headerMatch && line.includes("{")) {
      const title = headerMatch[1];
      if (title === "bind") {
        inBind = true;
        currentNodeTitle = null;
        continue;
      }
      currentNodeTitle = title;
      ensureNodeInfo(title);
      continue;
    }

    // 노드 블록 내부
    if (currentNodeTitle) {
      if (line.startsWith("},")) {
        currentNodeTitle = null;
        continue;
      }
      if (line.startsWith("}")) {
        currentNodeTitle = null;
        continue;
      }

      // 예:  0 -> 0   (노드 내부 in→out 연결)
      const m = line.match(/^(\d+)\s*->\s*(\d+)/);
      if (m) {
        const inIdx = parseInt(m[1], 10);
        const outIdx = parseInt(m[2], 10);
        if (Number.isNaN(inIdx) || Number.isNaN(outIdx)) continue;

        const info = ensureNodeInfo(currentNodeTitle);
        if (info.inputCount < inIdx + 1) info.inputCount = inIdx + 1;
        if (info.outputCount < outIdx + 1) info.outputCount = outIdx + 1;

        if (!internalConns.has(currentNodeTitle)) {
          internalConns.set(currentNodeTitle, []);
        }
        internalConns.get(currentNodeTitle).push({ inIdx, outIdx });
      }

      continue;
    }
  }

  // ---- 여기서 nodeInfoMap + binds + internalConns 기반으로 실제 nodes/ports/edges 구성 ----
  const newNodes = [];
  const newPorts = [];
  const newEdges = [];

  const nodeTitleToId = new Map();
  const inPortMap = new Map(); // "title:idx" -> portId
  const outPortMap = new Map(); // "title:idx" -> portId

  const infos = Array.from(nodeInfoMap.values()).sort((a, b) => {
    if (a.type === b.type) {
      return getIndexFromTitle(a.title) - getIndexFromTitle(b.title);
    }
    return a.type.localeCompare(b.type);
  });

  infos.forEach((info) => {
    const nodeId = genNodeId();
    nodeTitleToId.set(info.title, nodeId);

    const inputs = [];
    const outputs = [];

    const inputCount = info.inputCount || 0;
    const outputCount = info.outputCount || 0;

    for (let i = 0; i < inputCount; i++) {
      const pid = genPortId();
      inputs.push(pid);
      newPorts.push({ id: pid, nodeId, side: "left" });
      inPortMap.set(`${info.title}:${i}`, pid);
    }
    for (let i = 0; i < outputCount; i++) {
      const pid = genPortId();
      outputs.push(pid);
      newPorts.push({ id: pid, nodeId, side: "right" });
      outPortMap.set(`${info.title}:${i}`, pid);
    }

    const height = calcNodeHeight(inputCount, outputCount);

    // type/인덱스에 따라 대충 grid 배치
    const TYPE_COLUMNS = ["vcap", "vproc", "venc", "vdec", "vout"];
    const typeIndex = TYPE_COLUMNS.indexOf(info.type);
    const col = typeIndex >= 0 ? typeIndex : TYPE_COLUMNS.length;
    const row = getIndexFromTitle(info.title);

    const baseX = 100;
    const baseY = 80;
    const dx = 220;
    const dy = 90;

    const x = baseX + col * dx;
    const y = baseY + row * dy;

    newNodes.push({
      id: nodeId,
      type: info.type,
      title: info.title,
      x,
      y,
      width: 160,
      height,
      inputs,
      outputs,
    });
  });

  // ---- 내부 연결(node 안) edge 생성 ----
  internalConns.forEach((arr, title) => {
    arr.forEach(({ inIdx, outIdx }) => {
      const inPortId = inPortMap.get(`${title}:${inIdx}`);
      const outPortId = outPortMap.get(`${title}:${outIdx}`);
      if (!inPortId || !outPortId) return;

      newEdges.push({
        id: genEdgeId(),
        // 방향은 output → input 으로 저장 (어차피 side로 구분할 수 있음)
        fromPortId: outPortId,
        toPortId: inPortId,
      });
    });
  });

  // ---- bind(노드 간 연결) edge 생성 ----
  binds.forEach((b) => {
    const srcPortId = outPortMap.get(`${b.srcTitle}:${b.srcIdx}`);
    const dstPortId = inPortMap.get(`${b.dstTitle}:${b.dstIdx}`);
    if (!srcPortId || !dstPortId) return;

    newEdges.push({
      id: genEdgeId(),
      fromPortId: srcPortId,
      toPortId: dstPortId,
    });
  });

  return { nodes: newNodes, ports: newPorts, edges: newEdges };
}


export default function NodeEditor() {
  // ---------------- 상태 ----------------
  const [nodes, setNodes] = useState([]); // { id, type, title, x, y, width, height, inputs, outputs }
  const [ports, setPorts] = useState([]); // { id, nodeId, side }
  const [edges, setEdges] = useState([]); // { id, fromPortId, toPortId }

  const [draggingConnection, setDraggingConnection] = useState(null);
  // draggingConnection = { fromPortId, x, y }

  const [draggingNode, setDraggingNode] = useState(null);
  // draggingNode = { nodeId, offsetX, offsetY }

  const [hoveredNodeId, setHoveredNodeId] = useState(null); // X 버튼 표시용

  const svgRef = useRef(null);

   const fileInputRef = useRef(null);
  // ---------------- 유틸 함수 ----------------
  function getPortById(id) {
    return ports.find((p) => p.id === id);
  }

  function getNodeById(id) {
    return nodes.find((n) => n.id === id);
  }

  // 포트의 화면 상 위치
  function getPortPosition(port) {
    const node = getNodeById(port.nodeId);
    if (!node) return { x: 0, y: 0 };

    const isLeft = port.side === "left";
    const list = isLeft ? node.inputs : node.outputs;
    const index = list.indexOf(port.id);

    const y = node.y + PORT_START_OFFSET_Y + index * PORT_SPACING;
    const x = isLeft ? node.x : node.x + node.width;

    return { x, y };
  }

  // ---------------- 포트 추가/삭제 ----------------
  function addPort(nodeId, side) {
    const newPortId = genPortId();

    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId) return n;

        let newInputs = n.inputs;
        let newOutputs = n.outputs;

        if (side === "left") {
          newInputs = [...n.inputs, newPortId];
        } else {
          newOutputs = [...n.outputs, newPortId];
        }

        const newHeight = calcNodeHeight(
          newInputs.length,
          newOutputs.length
        );

        return {
          ...n,
          inputs: newInputs,
          outputs: newOutputs,
          height: newHeight,
        };
      })
    );

    setPorts((prev) => [
      ...prev,
      {
        id: newPortId,
        nodeId,
        side, // "left" | "right"
      },
    ]);
  }

  function removePort(portId) {
    const port = getPortById(portId);
    if (!port) return;

    const { nodeId, side } = port;

    // 노드에서 포트 제거 + 높이 재계산
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId) return n;

        let newInputs = n.inputs;
        let newOutputs = n.outputs;

        if (side === "left") {
          newInputs = n.inputs.filter((id) => id !== portId);
        } else {
          newOutputs = n.outputs.filter((id) => id !== portId);
        }

        const newHeight = calcNodeHeight(
          newInputs.length,
          newOutputs.length
        );

        return {
          ...n,
          inputs: newInputs,
          outputs: newOutputs,
          height: newHeight,
        };
      })
    );

    // 포트 목록에서 제거
    setPorts((prev) => prev.filter((p) => p.id !== portId));

    // 엣지에서 제거
    setEdges((prev) =>
      prev.filter(
        (e) => e.fromPortId !== portId && e.toPortId !== portId
      )
    );
  }

  // ---------------- 노드 삭제 + index 재정렬 ----------------
  function deleteNode(nodeId) {
    const nodeToDelete = getNodeById(nodeId);
    if (!nodeToDelete) return;

    const { type, title, inputs, outputs } = nodeToDelete;
    const deletedIndex = getIndexFromTitle(title);

    const portsToRemove = [...inputs, ...outputs];

    // 1) 포트/엣지 정리
    setPorts((prevPorts) =>
      prevPorts.filter((p) => !portsToRemove.includes(p.id))
    );

    setEdges((prevEdges) =>
      prevEdges.filter(
        (e) =>
          !portsToRemove.includes(e.fromPortId) &&
          !portsToRemove.includes(e.toPortId)
      )
    );

    // 2) 노드들 정리 + 같은 type의 index 재정렬
    setNodes((prevNodes) => {
      // 우선 삭제 대상 제거
      const remaining = prevNodes.filter((n) => n.id !== nodeId);

      // 같은 type 중, index > deletedIndex 인 애들만 index - 1
      return remaining.map((n) => {
        if (n.type !== type) return n;

        const idx = getIndexFromTitle(n.title);
        if (idx > deletedIndex) {
          const newIndex = idx - 1;
          return {
            ...n,
            title: makeTitle(type, newIndex),
          };
        }
        return n;
      });
    });
  }

  function handleDeleteNodeClick(e, nodeId) {
    e.stopPropagation();
    const node = getNodeById(nodeId);
    if (!node) return;

    const ok = window.confirm(
      `노드 "${node.title}" 를 삭제할까요?\n(같은 type의 뒤 인덱스들이 앞으로 당겨집니다)`
    );
    if (!ok) return;

    deleteNode(nodeId);
  }

  // ---------------- 엣지(연결) ----------------
  function createEdge(fromPortId, toPortId) {
    const from = getPortById(fromPortId);
    const to = getPortById(toPortId);
    if (!from || !to) return;

    // 같은 방향끼리 연결 금지
    if (from.side === to.side) return;

    // 이미 존재하는지 확인
    const exists = edges.some(
      (e) =>
        (e.fromPortId === fromPortId && e.toPortId === toPortId) ||
        (e.fromPortId === toPortId && e.toPortId === fromPortId)
    );
    if (exists) return;

    // 방향은 여기서는 그대로 저장 (나중에 export 시 side로 판단)
    setEdges((prev) => [
      ...prev,
      {
        id: genEdgeId(),
        fromPortId,
        toPortId,
      },
    ]);
  }

  // ---------------- 포트 이벤트 ----------------
  function handlePortMouseDown(e, portId) {
    if (e.button !== 0) return; // 왼쪽 버튼
    e.stopPropagation();

    const port = getPortById(portId);
    if (!port) return;

    const { x, y } = getPortPosition(port);
    setDraggingConnection({ fromPortId: portId, x, y });
  }

  function handlePortMouseUp(e, portId) {
    e.stopPropagation();
    if (!draggingConnection) return;

    const fromId = draggingConnection.fromPortId;
    if (fromId === portId) {
      setDraggingConnection(null);
      return;
    }

    createEdge(fromId, portId);
    setDraggingConnection(null);
  }

  function handlePortContextMenu(e, portId) {
    e.preventDefault();
    e.stopPropagation();
    removePort(portId);
  }

  // ---------------- 노드 드래그 ----------------
  function handleNodeMouseDown(e, nodeId) {
    if (e.button !== 0) return; // 왼쪽 버튼만
    e.stopPropagation();

    const svg = svgRef.current;
    if (!svg) return;

    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursor = pt.matrixTransform(svg.getScreenCTM().inverse());

    const node = getNodeById(nodeId);
    if (!node) return;

    const offsetX = cursor.x - node.x;
    const offsetY = cursor.y - node.y;

    setDraggingNode({ nodeId, offsetX, offsetY });
  }

  // ---------------- SVG 배경 이벤트 ----------------
  function handleSvgMouseMove(e) {
    const svg = svgRef.current;
    if (!svg) return;

    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursor = pt.matrixTransform(svg.getScreenCTM().inverse());

    if (draggingConnection) {
      setDraggingConnection((prev) =>
        prev ? { ...prev, x: cursor.x, y: cursor.y } : null
      );
    }

    if (draggingNode) {
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== draggingNode.nodeId) return n;
          return {
            ...n,
            x: cursor.x - draggingNode.offsetX,
            y: cursor.y - draggingNode.offsetY,
          };
        })
      );
    }
  }

  function handleSvgMouseUp() {
    if (draggingConnection) setDraggingConnection(null);
    if (draggingNode) setDraggingNode(null);
  }

  // ---------------- 노드 추가 (타입별) ----------------
  function handleAddNodeOfType(type) {
    const nodeId = genNodeId();
    const leftPortId = genPortId();
    const rightPortId = genPortId();
    const height = calcNodeHeight(1, 1);

    // 현재 같은 type의 개수 = 다음 index
    const sameTypeCount = nodes.filter((n) => n.type === type).length;
    const index = sameTypeCount;
    const title = makeTitle(type, index);

    setNodes((prev) => [
      ...prev,
      {
        id: nodeId,
        type, // "vcap" | "vproc" | "venc" | "vdec" | "vout"
        title, // 예: "vcap@0"
        x: 200 + prev.length * 40,
        y: 120 + prev.length * 30,
        width: 160,
        height,
        inputs: [leftPortId],
        outputs: [rightPortId],
      },
    ]);

    setPorts((prev) => [
      ...prev,
      { id: leftPortId, nodeId, side: "left" },
      { id: rightPortId, nodeId, side: "right" },
    ]);
  }

  // ---------------- Export 로직 ----------------
  function buildExportText() {
    const lines = [];
    lines.push("{");

    const sortedNodes = [...nodes].sort((a, b) => {
      if (a.type === b.type) {
        return getIndexFromTitle(a.title) - getIndexFromTitle(b.title);
      }
      return a.type.localeCompare(b.type);
    });

    // 노드 블록
    sortedNodes.forEach((node, idx) => {
      lines.push(`${node.title} : {`);

      const inputCount = node.inputs.length;
      const outputCount = node.outputs.length;

      if (inputCount > 0 && outputCount > 0) {
        for (let i = 0; i < inputCount; i++) {
          let outIdx = 0;
          if (outputCount > 0) {
            outIdx = Math.min(i, outputCount - 1);
          }
          lines.push(`  ${i} -> ${outIdx}`);
        }
      }

      lines.push("},");

      if (idx === sortedNodes.length - 1) {
        lines.push("");
      }
    });

    // bind 블록
    lines.push("bind : {");

    edges.forEach((edge) => {
      const pA = getPortById(edge.fromPortId);
      const pB = getPortById(edge.toPortId);
      if (!pA || !pB) return;

      let outPort, inPort;
      if (pA.side === "right" && pB.side === "left") {
        outPort = pA;
        inPort = pB;
      } else if (pA.side === "left" && pB.side === "right") {
        outPort = pB;
        inPort = pA;
      } else {
        return;
      }

      const outNode = getNodeById(outPort.nodeId);
      const inNode = getNodeById(inPort.nodeId);
      if (!outNode || !inNode) return;

      // 🔴 같은 node 내부 연결은 bind에 포함하지 않음
      if (outNode.id === inNode.id) {
        return;
      }

      const outIndex = outNode.outputs.indexOf(outPort.id);
      const inIndex = inNode.inputs.indexOf(inPort.id);
      if (outIndex < 0 || inIndex < 0) return;

      lines.push(
        `  ${outNode.title}:${outIndex} -> ${inNode.title}:${inIndex}`
      );
    });

    lines.push("}");
    lines.push("}");

    return lines.join("\n");
  }

  function handleExport() {
    const text = buildExportText();
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "node_graph.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------------- Import (파일) 로직 ----------------
  function handleImportFileClick() {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }

  function handleImportFileChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text =
          typeof reader.result === "string"
            ? reader.result
            : new TextDecoder("utf-8").decode(reader.result);

        const { nodes: newNodes, ports: newPorts, edges: newEdges } =
          parseConfigText(text); // 🔸 앞에서 만든 파서 재사용

        setNodes(newNodes);
        setPorts(newPorts);
        setEdges(newEdges);
      } catch (err) {
        console.error(err);
        window.alert("파일 파싱 중 오류가 발생했습니다.\n콘솔 로그를 확인하세요.");
      } finally {
        // 같은 파일 다시 선택 가능하게 초기화
        e.target.value = "";
      }
    };

    reader.readAsText(file); // txt니까 그냥 text로 읽으면 됨
  }
  // ---------------- 렌더링 ----------------
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#1e1e1e",
        color: "#eee",
        fontFamily: "sans-serif",
      }}
    >
      {/* 상단 툴바 */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #333",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span style={{ marginRight: 8 }}>Add node:</span>
        <button onClick={() => handleAddNodeOfType("vcap")}>vcap</button>
        <button onClick={() => handleAddNodeOfType("vproc")}>vproc</button>
        <button onClick={() => handleAddNodeOfType("venc")}>venc</button>
        <button onClick={() => handleAddNodeOfType("vdec")}>vdec</button>
        <button onClick={() => handleAddNodeOfType("vout")}>vout</button>

        <button
          onClick={handleExport}
          style={{ marginLeft: 24, fontWeight: "bold" }}
        >
          Export text
        </button>
        <button onClick={handleImportFileClick}>
          Import text (file)
        </button>
        <span style={{ fontSize: 12, opacity: 0.8, marginLeft: 16 }}>
          - Export: 현재 그래프를 설정 텍스트로 저장<br />
          - Import: 텍스트를 붙여넣어 그래프 복원<br />
          - bind에는 노드 간 연결만 (노드 내부 연결은 제외)
        </span>
      </div>

      {/* 🔹 숨겨진 파일 선택 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt"
        style={{ display: "none" }}
        onChange={handleImportFileChange}
      />
      
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ flex: 1, display: "block", background: "#252526" }}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
      >
        {/* 노드들 먼저 그리기 */}
        {nodes.map((node) => (
          <g
            key={node.id}
            onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
            onMouseEnter={() => setHoveredNodeId(node.id)}
            onMouseLeave={() =>
              setHoveredNodeId((prev) => (prev === node.id ? null : prev))
            }
          >
            {/* 노드 박스 */}
            <rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx="8"
              ry="8"
              fill="#3c3c3c"
              stroke="#555"
              strokeWidth="1"
              style={{ cursor: "move" }}
            />

            {/* 제목만 표시 (예: vcap@0) */}
            <text
              x={node.x + 8}
              y={node.y + 20}
              fill="#fff"
              fontSize="12"
            >
              {node.title}
            </text>

            {/* X 삭제 버튼 (hover 시에만 표시) */}
            {hoveredNodeId === node.id && (
              <g
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => handleDeleteNodeClick(e, node.id)}
                style={{ cursor: "pointer" }}
              >
                <rect
                  x={node.x + node.width - 18}
                  y={node.y + 4}
                  width="14"
                  height="14"
                  rx="3"
                  ry="3"
                  fill="#aa0000"
                />
                <text
                  x={node.x + node.width - 11}
                  y={node.y + 13}
                  textAnchor="middle"
                  alignmentBaseline="middle"
                  fill="#fff"
                  fontSize="12"
                >
                  ×
                </text>
              </g>
            )}

            {/* 왼쪽 + 버튼 - 노드 상단 */}
            <g
              onClick={() => addPort(node.id, "left")}
              onMouseDown={(e) => e.stopPropagation()}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={node.x - 18}
                y={node.y + 4}
                width="16"
                height="16"
                rx="3"
                ry="3"
                fill="#007acc"
              />
              <text
                x={node.x - 10}
                y={node.y + 12}
                textAnchor="middle"
                alignmentBaseline="middle"
                fill="#fff"
                fontSize="14"
              >
                +
              </text>
            </g>

            {/* 오른쪽 + 버튼 - 노드 상단 */}
            <g
              onClick={() => addPort(node.id, "right")}
              onMouseDown={(e) => e.stopPropagation()}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={node.x + node.width + 2}
                y={node.y + 4}
                width="16"
                height="16"
                rx="3"
                ry="3"
                fill="#007acc"
              />
              <text
                x={node.x + node.width + 10}
                y={node.y + 12}
                textAnchor="middle"
                alignmentBaseline="middle"
                fill="#fff"
                fontSize="14"
              >
                +
              </text>
            </g>

            {/* 왼쪽 포트들 */}
            {node.inputs.map((portId) => {
              const port = getPortById(portId);
              if (!port) return null;
              const { x, y } = getPortPosition(port);
              return (
                <circle
                  key={portId}
                  cx={x}
                  cy={y}
                  r="5"
                  fill="#50fa7b"
                  stroke="#111"
                  strokeWidth="1"
                  onMouseDown={(e) => handlePortMouseDown(e, portId)}
                  onMouseUp={(e) => handlePortMouseUp(e, portId)}
                  onContextMenu={(e) => handlePortContextMenu(e, portId)}
                  style={{ cursor: "pointer" }}
                />
              );
            })}

            {/* 오른쪽 포트들 */}
            {node.outputs.map((portId) => {
              const port = getPortById(portId);
              if (!port) return null;
              const { x, y } = getPortPosition(port);
              return (
                <circle
                  key={portId}
                  cx={x}
                  cy={y}
                  r="5"
                  fill="#ff79c6"
                  stroke="#111"
                  strokeWidth="1"
                  onMouseDown={(e) => handlePortMouseDown(e, portId)}
                  onMouseUp={(e) => handlePortMouseUp(e, portId)}
                  onContextMenu={(e) => handlePortContextMenu(e, portId)}
                  style={{ cursor: "pointer" }}
                />
              );
            })}
          </g>
        ))}

        {/* 엣지(선) – 노드 위 레이어, 이벤트는 투명 처리 */}
        {edges.map((edge) => {
          const from = getPortById(edge.fromPortId);
          const to = getPortById(edge.toPortId);
          if (!from || !to) return null;
          const p1 = getPortPosition(from);
          const p2 = getPortPosition(to);

          return (
            <line
              key={edge.id}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="#8be9fd"
              strokeWidth="2"
              pointerEvents="none"
            />
          );
        })}

        {/* 드래그 중 임시 선 */}
        {draggingConnection && (() => {
          const from = getPortById(draggingConnection.fromPortId);
          if (!from) return null;
          const start = getPortPosition(from);
          const end = { x: draggingConnection.x, y: draggingConnection.y };
          return (
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke="#ffb86c"
              strokeWidth="2"
              strokeDasharray="4 4"
              pointerEvents="none"
            />
          );
        })()}
      </svg>
    </div>
  );
}
